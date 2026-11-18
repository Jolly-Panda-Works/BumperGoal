// Server balance overrides (admin panel) layered over the bundled config.
// The last overrides are cached so offline play and the next launch use them too.
import { useSyncExternalStore } from 'react';
import { appliedConfig, applyConfigOverrides, subscribeConfig, type Overrides } from '@flickkick/config';
import { customLanguages, setCustomLanguages, type CustomLanguage } from '../i18n/languages';
import { configAssetRefs, ensureAssets } from './assets';
import { readJson, writeJson } from './storage';

const CONFIG_KEY = 'flickkick.config.v1';

interface ServerConfig {
  revision: number;
  overrides: Overrides;
}

export function adoptServerConfig(config: ServerConfig): void {
  applyConfigOverrides(config.revision, config.overrides ?? {});
  writeJson(CONFIG_KEY, appliedConfig());
}

/** Fetches the server's overrides when its revision differs from the applied one. */
export async function syncServerConfig(
  revision: number | undefined,
  fetch: () => Promise<ServerConfig>,
): Promise<void> {
  if (revision === undefined || revision === appliedConfig().revision) return;
  adoptServerConfig(await fetch());
}

const cached = readJson<ServerConfig>(CONFIG_KEY);
if (cached && typeof cached.revision === 'number' && cached.overrides && typeof cached.overrides === 'object') {
  applyConfigOverrides(cached.revision, cached.overrides);
  void ensureAssets(configAssetRefs()); // uploaded art from the device cache
}

/** Re-renders when the balance changes; components read the config objects directly. */
export function useConfigRevision(): number {
  return useSyncExternalStore(subscribeConfig, () => appliedConfig().revision);
}

// ---- Languages added in the admin panel ----

interface LanguageMeta {
  code: string;
  label: string;
  dir: 'ltr' | 'rtl';
  locale: string;
  version: number;
}
interface LanguagesResponse {
  revision: number;
  languages: LanguageMeta[];
  translations: Record<string, Record<string, unknown>>;
}

const LANGUAGES_REVISION_KEY = 'flickkick.languagesRevision.v1';
let languagesRevision = readJson<number>(LANGUAGES_REVISION_KEY) ?? 0;

/** Fetches the enabled admin languages when their revision changed; only new versions are downloaded. */
export async function syncServerLanguages(
  revision: number | undefined,
  fetch: (input: object) => Promise<LanguagesResponse>,
): Promise<void> {
  if (revision === undefined || revision === languagesRevision) return;
  const index = await fetch({});
  const have = customLanguages();
  const cached = (m: LanguageMeta) => have.find((h) => h.code === m.code && h.version === m.version);
  const missing = index.languages.filter((m) => !cached(m)).map((m) => m.code);
  const fresh = missing.length > 0 ? await fetch({ codes: missing }) : null;
  const list: CustomLanguage[] = [];
  for (const m of index.languages) {
    const translation = cached(m)?.translation ?? fresh?.translations[m.code];
    if (translation) list.push({ ...m, translation });
  }
  setCustomLanguages(list);
  languagesRevision = revision;
  writeJson(LANGUAGES_REVISION_KEY, revision);
}
