// Operator balancing panel (/admin). Signs in with the server's ADMIN_USERNAME /
// ADMIN_PASSWORD and edits balance overrides; the Nakama server validates,
// stores and applies them. Internal tool: English only, loaded as its own chunk.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ARENA_THEMES,
  aimRange,
  forceScale,
  timeScale,
  THEME_PATH,
  cloneJson,
  isLocked,
  locate,
  isVariableList,
  leafKind,
  segmentFor,
  type ConfigDocs,
  type ConfigFile,
  type LeafKind,
  type Overrides,
  type PhysicsConfig,
} from '@flickkick/config';
import { assetUrl, bundledAvatarUrl, bundledBallUrl, bundledDiscUrl, themeArt, uiUrl } from '../game/art';
import { connect, describeError, onlineConfigured, rpc, useOnline } from '../services/online';
import { adoptServerConfig } from '../services/remoteConfig';
import { readJson, removeKey, writeJson } from '../services/storage';
import { ArenasPage, EconomyPage } from './adminArenas';
import { AdminLanguages, AdminSettings } from './adminLanguages';
import { PhysicsPreview, type Scenario } from './adminPhysics';
import { adminDir, fieldHelp, fieldLabel, num, tr, useAdminLang, type AdminKey } from './adminText';
import { FormationEditor, ImageEditor, revealDetail, type PitchSize } from './adminWidgets';
import { configAssetRefs, ensureAssets, type FetchedAsset } from '../services/assets';
import '../styles/admin.css';

const TOKEN_KEY = 'flickkick.admin.v1';

type Page = ConfigFile | 'formations' | 'languages' | 'history' | 'reports' | 'settings';

const PAGES: Record<Page, { icon: string }> = {
  economy: {
    icon: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm1 14.5V19h-2v-1.5c-1.6-.3-2.8-1.3-3-2.8l2-.4c.2.9 1 1.5 2.2 1.5 1.1 0 1.8-.5 1.8-1.2 0-.6-.4-1-2-1.4-2.1-.5-3.6-1.2-3.6-3 0-1.4 1.1-2.5 2.6-2.8V6h2v1.5c1.4.3 2.4 1.2 2.6 2.5l-2 .4c-.2-.7-.8-1.2-1.8-1.2s-1.6.5-1.6 1.1c0 .6.6.9 2.1 1.3 2.2.5 3.5 1.3 3.5 3.1 0 1.5-1.1 2.6-2.8 2.8z',
  },
  cosmetics: {
    icon: 'M4 7h16l-1.5 12.5a2 2 0 0 1-2 1.5h-9a2 2 0 0 1-2-1.5L4 7zm4 0V6a4 4 0 0 1 8 0v1h-2V6a2 2 0 0 0-4 0v1H8z',
  },
  formations: {
    icon: 'M3 5h18v14H3V5zm2 2v10h6V7H5zm8 0v10h6V7h-6zM7 9.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm10 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z',
  },
  arenas: {
    icon: 'M3 20V9l9-5 9 5v11h-6v-6H9v6H3z',
  },
  progression: {
    icon: 'M4 20h4V10H4v10zm6 0h4V4h-4v16zm6 0h4v-7h-4v7z',
  },
  rules: {
    icon: 'M6 2h12v4l-4 4 4 4v4H6v-4l4-4-4-4V2zm2 2v1.2l4 4 4-4V4H8z',
  },
  physics: {
    icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 4 2.5 1.8-1 3h-3l-1-3L12 6zm-6.2 5.3 2.4.8.9 2.9-1.7 2.3a8 8 0 0 1-1.6-6zm12.4 0a8 8 0 0 1-1.6 6l-1.7-2.3.9-2.9 2.4-.8z',
  },
  'ai-profiles': {
    icon: 'M9 2h6v2h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3V2zm0 8a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm6 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm-6 5v2h6v-2H9z',
  },
  languages: {
    icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.9 6h-3a15.7 15.7 0 0 0-1.4-3.6A8 8 0 0 1 18.9 8zM12 4c.8 1.2 1.5 2.5 1.9 4h-3.8c.4-1.5 1.1-2.8 1.9-4zM4.3 14a8.2 8.2 0 0 1 0-4h3.4a16.5 16.5 0 0 0 0 4H4.3zm.8 2h3c.3 1.3.8 2.5 1.4 3.6A8 8 0 0 1 5.1 16zm3-8h-3a8 8 0 0 1 4.4-3.6C8.9 5.5 8.4 6.7 8.1 8zM12 20c-.8-1.2-1.5-2.5-1.9-4h3.8c-.4 1.5-1.1 2.8-1.9 4zm2.3-6H9.7a14.7 14.7 0 0 1 0-4h4.6a14.7 14.7 0 0 1 0 4zm.3 5.6c.6-1.1 1.1-2.3 1.4-3.6h3a8 8 0 0 1-4.4 3.6zM16.3 14a16.5 16.5 0 0 0 0-4h3.4a8.2 8.2 0 0 1 0 4h-3.4z',
  },
  history: {
    icon: 'M13 3a9 9 0 1 0 8.9 10.3l-2-.3A7 7 0 1 1 13 5a7 7 0 0 1 5 2.1L15 10h7V3l-2.6 2.6A9 9 0 0 0 13 3zm-1 5v5.4l4.3 2.6 1-1.7-3.3-2V8h-2z',
  },
  reports: {
    icon: 'M5 3h2v18H5V3zm3 1h11l-2.5 4.5L19 13H8V4z',
  },
  settings: {
    icon: 'M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.7 7.7 0 0 0-1.7-1L15 3h-4l-.4 2.7a7.7 7.7 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1c.5.4 1.1.7 1.7 1L11 21h4l.4-2.7c.6-.3 1.2-.6 1.7-1l2.5 1 2-3.5-2.2-1.8zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z',
  },
};

const pageLabel = (p: Page) => tr(`page.${p}` as AdminKey);
const pageHint = (p: Page) => tr(`page.${p}.hint` as AdminKey);

interface AuditEntry {
  revision: number;
  at: number;
  by: string;
  changes: { path: string; before?: unknown; after?: unknown }[];
}

interface AdminState {
  revision: number;
  overrides: Overrides;
  stale: string[];
  defaults: ConfigDocs;
  audit: AuditEntry[];
  updatedAt: number;
}

type Price = Partial<Record<'coins' | 'gems', number>>;
type Point = [number, number];

const FORMATION_PATH = /^(rules\/formation|cosmetics\/formations\/@[^/]+\/positions)$/;
const TEAM_PATH = /^cosmetics\/teams\/@([^/]+)$/;
const AI_PATH = /^ai-profiles\/profiles\/@([^/]+)$/;
/** Shop entries that can get an uploaded picture. */
const SHOP_ITEM = /^cosmetics\/(teams|balls|avatars|trails|currencyPacks)\/@([^/]+)$/;
const FORMATION_ITEM = /^cosmetics\/formations\/@[^/]+$/;

/** Leaf kinds the panel adds on top of leafKind (string choices such as an arena's theme). */
const choiceKind = (path: string): LeafKind | null => (THEME_PATH.test(path) ? 'choice' : null);

function themePreviewUrl(theme: string): string | undefined {
  const art = themeArt(theme);
  return art ? assetUrl(art.bg.file) : undefined;
}

/** Sidebar page an override path belongs to. */
function pageOf(path: string): Page {
  if (path.startsWith('rules/formation/') || path.startsWith('cosmetics/formations/')) return 'formations';
  return path.split('/')[0] as Page;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const humanize = fieldLabel;

function show(v: unknown): string {
  if (v === undefined) return '—';
  if (v === null) return tr('value.free');
  if (typeof v === 'string' && v.startsWith('data:image')) return tr('value.uploaded');
  if (typeof v === 'number') return num(v);
  if (Array.isArray(v) && v.length > 0 && v.every(isObject)) return v.map(show).join(' · ');
  if (isObject(v) && Object.keys(v).every((k) => k === 'coins' || k === 'gems')) {
    return Object.entries(v)
      .map(
        ([k, n]) => `${typeof n === 'number' ? num(n) : String(n)} ${tr(k === 'gems' ? 'price.gems' : 'price.coins')}`,
      )
      .join(' + ');
  }
  return JSON.stringify(v);
}

function readToken(): string | null {
  const saved = readJson<{ token: string; expiresAt: number }>(TOKEN_KEY);
  return saved && saved.expiresAt * 1000 > Date.now() + 60_000 ? saved.token : null;
}

function stepFor(def: number): number {
  if (!Number.isInteger(def)) return Math.abs(def) < 1 ? 0.01 : 0.1;
  return Math.max(1, 10 ** (Math.floor(Math.log10(Math.max(1, Math.abs(def)))) - 1));
}

function timeAgo(unix: number): string {
  if (!unix) return tr('time.never');
  const s = Math.max(0, Date.now() / 1000 - unix);
  if (s < 60) return tr('time.justNow');
  if (s < 3600) return tr('time.minAgo', { n: num(Math.floor(s / 60)) });
  if (s < 86400) return tr('time.hAgo', { n: num(Math.floor(s / 3600)) });
  return new Date(unix * 1000).toLocaleDateString();
}

function Icon({ d }: { d: string }) {
  return (
    <svg className="dash__icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export function AdminScreen() {
  const lang = useAdminLang();
  const online = useOnline();
  const [token, setToken] = useState<string | null>(readToken);
  const [data, setData] = useState<AdminState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // The panel is a normal page: leave the game's fullscreen mode.
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (online.status === 'offline' || online.status === 'error') void connect();
  }, [online.status]);

  const signOut = useCallback(() => {
    removeKey(TOKEN_KEY);
    setToken(null);
    setData(null);
  }, []);

  const load = useCallback(
    async (t: string) => {
      try {
        setData(await rpc<AdminState>('admin_config_get', { token: t }));
        setError(null);
      } catch (err) {
        if (err instanceof Response && err.status === 401) signOut();
        setError(await describeError(err));
      }
    },
    [signOut],
  );

  useEffect(() => {
    if (token && online.status === 'online' && !data) void load(token);
  }, [token, online.status, data, load]);

  if (token && data) {
    return <Dashboard token={token} data={data} onSaved={setData} onSignOut={signOut} />;
  }

  let body: React.ReactNode;
  if (!onlineConfigured) body = <p className="admin__note">{tr('conn.notConfigured')}</p>;
  else if (online.status !== 'online')
    body = (
      <p className="admin__note">
        {tr('conn.connecting')} {online.error}
      </p>
    );
  else if (!token) body = <Login onToken={setToken} />;
  else body = <p className="admin__note">{error ?? tr('conn.loading')}</p>;

  return (
    <div className="admin admin--center" dir={adminDir()} lang={lang}>
      <div className="admin__card">
        <div className="dash__brand dash__brand--center">
          <span className="dash__logo">FK</span>
          <span>
            <b>Bumper Goal</b>
            <small>{tr('brand.sub')}</small>
          </span>
        </div>
        {body}
      </div>
    </div>
  );
}

function Login({ onToken }: { onToken: (t: string) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await rpc<{ token: string; expiresAt: number }>('admin_login', { username, password });
      writeJson(TOKEN_KEY, res);
      onToken(res.token);
    } catch (err) {
      setError(await describeError(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="admin__login" onSubmit={(e) => void submit(e)}>
      <label>
        {tr('login.username')}
        <input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
      </label>
      <label>
        {tr('login.password')}
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </label>
      {error && <p className="admin__error">{error}</p>}
      <button type="submit" className="admin__btn admin__btn--primary" disabled={busy}>
        {tr('login.submit')}
      </button>
    </form>
  );
}

interface DashboardProps {
  token: string;
  data: AdminState;
  onSaved: (d: AdminState) => void;
  onSignOut: () => void;
}

export interface EditContext {
  token: string;
  defaults: ConfigDocs;
  draft: Overrides;
  saved: Overrides;
  query: string;
  pitch: PitchSize;
  onChange: (path: string, value: unknown, def: unknown) => void;
}

function Dashboard({ token, data, onSaved, onSignOut }: DashboardProps) {
  const lang = useAdminLang();
  const [page, setPage] = useState<Page>('economy');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<Overrides>(() => cloneJson(data.overrides));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => setDraft(cloneJson(data.overrides)), [data]);

  useEffect(() => {
    void ensureAssets(configAssetRefs(), (id) => rpc<FetchedAsset>('asset_get', { id }));
  }, [data.revision]);

  const pending = useMemo(() => {
    const paths = new Set([...Object.keys(draft), ...Object.keys(data.overrides)]);
    return [...paths].filter((p) => !same(draft[p], data.overrides[p]));
  }, [draft, data.overrides]);

  const onChange = useCallback((path: string, value: unknown, def: unknown) => {
    setDraft((d) => {
      const next = { ...d };
      if (value === undefined || same(value, def)) delete next[path];
      else next[path] = value;
      return next;
    });
  }, []);

  const save = async (overrides: Overrides) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await rpc<AdminState>('admin_config_set', { token, revision: data.revision, overrides });
      onSaved(res);
      adoptServerConfig({ revision: res.revision, overrides: res.overrides });
      setMessage({ ok: true, text: tr('msg.saved', { n: num(res.revision) }) });
    } catch (err) {
      if (err instanceof Response && err.status === 401) onSignOut();
      setMessage({ ok: false, text: await describeError(err) });
    } finally {
      setBusy(false);
    }
  };

  // Pitch size for the formation editor; arena size is locked, so read it from the document.
  const physics = data.defaults.physics as {
    arena: { halfWidth: number; halfHeight: number; goalHalfWidth: number; goalDepth: number };
    disc: { radius: number };
  };
  const drafted = (path: string, fallback: number) =>
    typeof draft[path] === 'number' ? (draft[path] as number) : fallback;
  const pitch: PitchSize = {
    halfWidth: physics.arena.halfWidth,
    halfHeight: physics.arena.halfHeight,
    goalHalfWidth: drafted('physics/arena/goalHalfWidth', physics.arena.goalHalfWidth),
    goalDepth: drafted('physics/arena/goalDepth', physics.arena.goalDepth),
    discRadius: drafted('physics/disc/radius', physics.disc.radius),
  };
  const ctx: EditContext = {
    token,
    defaults: data.defaults,
    draft,
    saved: data.overrides,
    query: query.trim().toLowerCase(),
    pitch,
    onChange,
  };
  const count = (p: Page) => Object.keys(draft).filter((k) => pageOf(k) === p).length;
  const editsBalance = page !== 'languages' && page !== 'settings' && page !== 'reports';

  return (
    <div className="dash" dir={adminDir()} lang={lang}>
      <aside className="dash__side">
        <div className="dash__brand">
          <span className="dash__logo">FK</span>
          <span>
            <b>Bumper Goal</b>
            <small>{tr('brand.sub')}</small>
          </span>
        </div>
        <nav className="dash__nav">
          {(Object.keys(PAGES) as Page[]).map((p) => (
            <button
              key={p}
              type="button"
              className={page === p ? 'is-active' : ''}
              aria-current={page === p ? 'page' : undefined}
              onClick={() => setPage(p)}
            >
              <Icon d={PAGES[p].icon} />
              <span>{pageLabel(p)}</span>
              {count(p) > 0 && <span className="dash__badge">{count(p)}</span>}
            </button>
          ))}
        </nav>
        <div className="dash__side-foot">
          <span className="dash__live">
            <i /> {tr('live', { n: num(data.revision) })}
          </span>
          <button type="button" className="admin__btn admin__btn--ghost" onClick={onSignOut}>
            {tr('action.signOut')}
          </button>
        </div>
      </aside>

      <main className="dash__main">
        <header className="dash__head">
          <div>
            <h1>{pageLabel(page)}</h1>
            <p>{pageHint(page)}</p>
          </div>
          {editsBalance && (
            <div className="dash__actions">
              <button
                type="button"
                className="admin__btn"
                disabled={busy || !pending.length}
                onClick={() => setDraft(cloneJson(data.overrides))}
              >
                {tr('action.discard')}
              </button>
              <button
                type="button"
                className="admin__btn admin__btn--primary"
                disabled={busy || !pending.length}
                onClick={() => void save(draft)}
              >
                {busy
                  ? tr('action.saving')
                  : pending.length === 1
                    ? tr('action.save1')
                    : pending.length
                      ? tr('action.save', { n: num(pending.length) })
                      : tr('action.saved')}
              </button>
            </div>
          )}
        </header>

        {editsBalance && (
          <div className="dash__stats">
            <Stat label={tr('stat.revision')} value={num(data.revision)} />
            <Stat label={tr('stat.overrides')} value={num(Object.keys(data.overrides).length)} />
            <Stat label={tr('stat.unsaved')} value={num(pending.length)} accent={pending.length > 0} />
            <Stat label={tr('stat.lastSaved')} value={timeAgo(data.updatedAt)} />
          </div>
        )}

        {message && <p className={message.ok ? 'admin__ok' : 'admin__error'}>{message.text}</p>}
        {data.stale.length > 0 && (
          <div className="admin__error">
            {tr('msg.stale')}
            {data.stale.map((p) => (
              <button
                key={p}
                type="button"
                className="admin__btn admin__btn--small"
                onClick={() => onChange(p, undefined, undefined)}
              >
                {tr('action.remove', { x: p })}
              </button>
            ))}
          </div>
        )}

        {page === 'settings' ? (
          <AdminSettings />
        ) : page === 'reports' ? (
          <VoiceReports token={token} onSignOut={onSignOut} />
        ) : page === 'languages' ? (
          <AdminLanguages token={token} onSignOut={onSignOut} />
        ) : page === 'history' ? (
          <History
            entries={data.audit}
            canReset={Object.keys(data.overrides).length > 0 && !busy}
            onReset={() => {
              if (window.confirm(tr('confirm.resetAll'))) void save({});
            }}
          />
        ) : (
          <>
            <div className="dash__toolbar">
              <input
                className="dash__search"
                type="search"
                placeholder={tr('search')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            {page === 'formations' ? (
              <FormationsPage ctx={ctx} />
            ) : page === 'arenas' ? (
              <ArenasPage ctx={ctx} />
            ) : page === 'economy' ? (
              <EconomyPage ctx={ctx} />
            ) : page === 'physics' ? (
              <PhysicsPage ctx={ctx} />
            ) : (
              <FilePage
                file={page}
                ctx={ctx}
                tabs={page === 'cosmetics'}
                skip={page === 'cosmetics' ? ['formations'] : page === 'rules' ? ['formation'] : []}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`dash__stat${accent ? ' is-accent' : ''}`}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

/** Child [segment, value, nearest object key] entries of a container. */
function children(value: unknown, name: string): [string, unknown, string][] {
  if (Array.isArray(value)) return value.map((v, i) => [segmentFor(value, i), v, name]);
  if (isObject(value)) return Object.entries(value).map(([k, v]) => [k, v, k]);
  return [];
}

function visible(value: unknown, path: string, name: string, query: string): boolean {
  if (isLocked(path)) return false;
  if (TEAM_PATH.test(path) && path.toLowerCase().includes(query)) return true;
  if (choiceKind(path) || leafKind(name, value)) return !query || path.toLowerCase().includes(query);
  return children(value, name).some(([seg, v, n]) => visible(v, `${path}/${seg}`, n, query));
}

const isItemList = (v: unknown) => Array.isArray(v) && v.length > 0 && v.every((e) => isObject(e) && 'id' in e);

/** One file: loose leaves in a "General" card, then a card per section. */
function FilePage({
  file,
  ctx,
  skip = [],
  tabs = false,
}: {
  file: ConfigFile;
  ctx: EditContext;
  skip?: string[];
  tabs?: boolean;
}) {
  const [tab, setTab] = useState<string | null>(null);
  const doc = ctx.defaults[file];
  const entries = children(doc, file).filter(
    ([seg, v, n]) => !skip.includes(seg) && visible(v, `${file}/${seg}`, n, ctx.query),
  );
  if (entries.length === 0) return <p className="admin__note">{tr('nothing')}</p>;
  const leaves = entries.filter(([, v, n]) => leafKind(n, v));
  const allSections = entries.filter(([, v, n]) => !leafKind(n, v));
  const active = allSections.find(([seg]) => seg === tab)?.[0] ?? allSections[0]?.[0];
  const sections = tabs ? allSections.filter(([seg]) => seg === active) : allSections;
  return (
    <div className="dash__cards">
      {tabs && allSections.length > 1 && (
        <nav className="ad-tabs" role="tablist">
          {allSections.map(([seg]) => {
            const changed = Object.keys(ctx.draft).filter((p) => p.startsWith(`${file}/${seg}/`)).length;
            return (
              <button
                key={seg}
                type="button"
                role="tab"
                aria-selected={seg === active}
                className={seg === active ? 'is-active' : ''}
                onClick={() => setTab(seg)}
              >
                {humanize(seg)}
                {changed > 0 && <span className="dash__badge">{num(changed)}</span>}
              </button>
            );
          })}
        </nav>
      )}
      {leaves.length > 0 && (
        <section className="ad-card">
          <h2>{tr('card.general')}</h2>
          {leaves.map(([seg, v, n]) => (
            <Node key={seg} value={v} path={`${file}/${seg}`} name={n} depth={1} ctx={ctx} />
          ))}
        </section>
      )}
      {sections.map(([seg, v, n]) => {
        const path = `${file}/${seg}`;
        const changed = Object.keys(ctx.draft).filter((p) => p.startsWith(`${path}/`) || p === path).length;
        return (
          <section key={seg} className={`ad-card${isItemList(v) || FORMATION_PATH.test(path) ? ' ad-card--wide' : ''}`}>
            <h2>
              {humanize(seg)}
              {changed > 0 && <span className="dash__badge">{changed}</span>}
            </h2>
            <Node value={v} path={path} name={n} depth={1} ctx={ctx} />
          </section>
        );
      })}
    </div>
  );
}

export function Node({
  value,
  path,
  name,
  depth,
  ctx,
}: {
  value: unknown;
  path: string;
  name: string;
  depth: number;
  ctx: EditContext;
}) {
  const kind = choiceKind(path) ?? leafKind(name, value);
  if (kind) return <LeafRow value={value} path={path} name={name} kind={kind} ctx={ctx} />;
  if (FORMATION_PATH.test(path) && Array.isArray(value))
    return <FormationNode value={value as Point[]} path={path} ctx={ctx} />;

  const items = children(value, name).filter(([seg, v, n]) => visible(v, `${path}/${seg}`, n, ctx.query));
  if (isItemList(value)) {
    return (
      <ItemBrowser
        items={items.map(([seg, v]) => ({ seg, value: v as Record<string, unknown> }))}
        path={path}
        name={name}
        ctx={ctx}
      />
    );
  }
  const rows = items.map(([seg, v, n]) => (
    <Node key={seg} value={v} path={`${path}/${seg}`} name={n} depth={depth + 1} ctx={ctx} />
  ));
  if (depth <= 1) return <>{rows}</>;
  return (
    <fieldset className="ad-group">
      <legend>
        {humanize(path.split('/').pop() ?? '')}
        <Tip field={name} />
      </legend>
      {rows}
    </fieldset>
  );
}

interface ItemEntry {
  seg: string;
  value: Record<string, unknown>;
}

/** Leaf paths of an item relative to it, e.g. "attributes/force" (formation layouts excluded). */
function leafPaths(value: unknown, rel: string, name: string, path: string): { rel: string; name: string }[] {
  if (isLocked(path) || FORMATION_PATH.test(path)) return [];
  if (leafKind(name, value) || choiceKind(path)) return [{ rel, name }];
  return children(value, name).flatMap(([seg, v, n]) => leafPaths(v, rel ? `${rel}/${seg}` : seg, n, `${path}/${seg}`));
}

function valueAt(value: unknown, rel: string): unknown {
  return rel
    .split('/')
    .reduce<unknown>(
      (cur, seg) => (isObject(cur) ? cur[seg] : Array.isArray(cur) ? cur[Number(seg)] : undefined),
      value,
    );
}

/**
 * Catalog entries (teams, arenas, AI levels…): the list on the left, the selected
 * entry's editor on the right. Ticking several entries compares them side by side.
 */
function ItemBrowser({ items, path, name, ctx }: { items: ItemEntry[]; path: string; name: string; ctx: EditContext }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [compare, setCompare] = useState<string[]>([]);
  const current = items.find((i) => i.seg === selected) ?? items[0];
  const compared = items.filter((i) => compare.includes(i.seg));
  const toggle = (seg: string) =>
    setCompare((c) => (c.includes(seg) ? c.filter((x) => x !== seg) : [...c, seg].slice(-6)));

  if (!current) return <p className="admin__note">{tr('nothing')}</p>;
  return (
    <div className="ad-browser">
      <div className="ad-browser__list" role="listbox" aria-label={humanize(name)}>
        <div className="ad-browser__hint">
          {compare.length > 1 ? (
            <>
              <span>{tr('browser.comparing', { n: num(compare.length) })}</span>
              <button type="button" className="admin__btn admin__btn--small" onClick={() => setCompare([])}>
                {tr('action.clear')}
              </button>
            </>
          ) : (
            <span>{tr('browser.count', { n: num(items.length) })}</span>
          )}
        </div>
        {items.map(({ seg, value }) => {
          const itemPath = `${path}/${seg}`;
          const changed = Object.keys(ctx.draft).filter((p) => p.startsWith(`${itemPath}/`)).length;
          const active = compare.length > 1 ? compare.includes(seg) : current.seg === seg;
          return (
            <div
              key={seg}
              role="option"
              aria-selected={active}
              tabIndex={0}
              className={`ad-browser__entry${active ? ' is-active' : ''}`}
              onClick={(e) => {
                setSelected(seg);
                revealDetail(e.currentTarget);
                if (compare.length > 1) setCompare([]);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setSelected(seg);
              }}
            >
              <input
                type="checkbox"
                aria-label={`Compare ${String(value.id)}`}
                checked={compare.includes(seg)}
                onClick={(e) => e.stopPropagation()}
                onChange={() => toggle(seg)}
              />
              <ItemHeader value={value} path={itemPath} ctx={ctx} />
              {changed > 0 && <span className="dash__badge">{changed}</span>}
            </div>
          );
        })}
      </div>
      <div className="ad-browser__detail">
        {compared.length > 1 ? (
          <CompareTable items={compared} path={path} name={name} ctx={ctx} />
        ) : (
          <ItemDetail value={current.value} path={`${path}/${current.seg}`} name={name} ctx={ctx} />
        )}
      </div>
    </div>
  );
}

function bundledItemImage(kind: string, id: string): string | undefined {
  switch (kind) {
    case 'teams':
      return bundledDiscUrl(id);
    case 'balls':
      return bundledBallUrl(id);
    case 'avatars':
      return bundledAvatarUrl(id);
    case 'trails':
      return assetUrl(`trails/${id}.webp`);
    case 'currencyPacks':
      return uiUrl(id.startsWith('pack_gems') ? 'pack_gems_s' : 'pack_coins_m');
  }
  return undefined;
}

/** Picture of a shop entry: the draft upload, else the bundled art; discs and balls are round. */
function itemImage(path: string, ctx: EditContext) {
  const m = SHOP_ITEM.exec(path);
  if (!m) return null;
  const [, kind = '', id = ''] = m;
  const bundled = bundledItemImage(kind, id);
  return {
    bundled,
    current: (ctx.draft[`${path}/image`] as string | undefined) ?? bundled,
    shape: kind === 'teams' || kind === 'balls' ? ('circle' as const) : ('square' as const),
  };
}

function ItemHeader({ value, path, ctx }: { value: Record<string, unknown>; path: string; ctx: EditContext }) {
  const image = itemImage(path, ctx);
  const theme = path.startsWith('arenas/') ? ((ctx.draft[`${path}/theme`] as string | undefined) ?? value.theme) : null;
  const preview = typeof theme === 'string' ? themePreviewUrl(theme) : undefined;
  const price =
    path.startsWith('cosmetics/') && 'price' in value ? (ctx.draft[`${path}/price`] ?? value.price) : undefined;
  const swatch = typeof value.primary === 'string' ? value.primary : null;
  let thumb: React.ReactNode = null;
  if (FORMATION_ITEM.test(path) && Array.isArray(value.positions)) {
    const pts = (value.positions as Point[]).map(
      (p, i) => (ctx.draft[`${path}/positions/${i}`] as Point | undefined) ?? p,
    );
    thumb = (
      <svg
        className="ad-item__thumb ad-item__thumb--wide ad-item__thumb--pitch"
        viewBox="-7.5 -4.5 7.5 9"
        aria-hidden="true"
      >
        {pts.map(([x, y], i) => (
          <circle key={i} cx={x} cy={-y} r={0.55} />
        ))}
      </svg>
    );
  } else if (AI_PATH.test(path)) {
    const id = AI_PATH.exec(path)![1]!;
    thumb = (
      <span className="ad-item__thumb ad-item__thumb--square">
        <img src={(ctx.draft[`${path}/image`] as string | undefined) ?? assetUrl(`lobby/bot_${id}.webp`)} alt="" />
      </span>
    );
  } else if (image)
    thumb = (
      <span className={`ad-item__thumb${image.shape === 'square' ? ' ad-item__thumb--square' : ''}`}>
        {image.current ? <img src={image.current} alt="" /> : null}
      </span>
    );
  else if (preview) thumb = <span className="ad-item__thumb ad-item__thumb--wide">{<img src={preview} alt="" />}</span>;
  else if (swatch) thumb = <span className="ad-item__thumb" style={{ background: swatch }} />;
  return (
    <>
      {thumb}
      <span className="ad-item__title">
        <b>{String(value.id)}</b>
        {typeof value.group === 'string' && <small>{value.group}</small>}
        {typeof theme === 'string' && <small>{tr('theme', { t: theme })}</small>}
      </span>
      {price !== undefined && <span className="ad-item__price">{show(price)}</span>}
    </>
  );
}

function ItemDetail({
  value,
  path,
  name,
  ctx,
}: {
  value: Record<string, unknown>;
  path: string;
  name: string;
  ctx: EditContext;
}) {
  const team = TEAM_PATH.exec(path)?.[1];
  const shopImage = itemImage(path, ctx);
  const bot = AI_PATH.exec(path)?.[1];
  const imagePath = `${path}/image`;
  const changed = Object.keys(ctx.draft).filter((p) => p.startsWith(`${path}/`));
  return (
    <div className="ad-detail">
      <div className="ad-detail__head">
        <ItemHeader value={value} path={path} ctx={ctx} />
        {changed.length > 0 && (
          <button
            type="button"
            className="admin__btn admin__btn--small"
            onClick={() => changed.forEach((p) => ctx.onChange(p, undefined, undefined))}
          >
            {tr('action.resetItem')}
          </button>
        )}
      </div>
      {shopImage && (
        <ImageEditor
          shape={shopImage.shape}
          current={shopImage.current}
          bundled={shopImage.bundled}
          overridden={imagePath in ctx.draft}
          onChange={(img) => ctx.onChange(imagePath, img, undefined)}
        />
      )}
      {team && isObject(value.attributes) && <TeamPreview path={path} value={value} ctx={ctx} />}
      {bot && (
        <ImageEditor
          shape="square"
          current={(ctx.draft[imagePath] as string | undefined) ?? assetUrl(`lobby/bot_${bot}.webp`)}
          bundled={assetUrl(`lobby/bot_${bot}.webp`)}
          overridden={imagePath in ctx.draft}
          onChange={(img) => ctx.onChange(imagePath, img, undefined)}
        />
      )}
      <Node value={value} path={path} name={name} depth={1} ctx={ctx} />
    </div>
  );
}

/** Entries side by side: one row per value; cells that differ from the first column are marked. */
function CompareTable({
  items,
  path,
  name,
  ctx,
}: {
  items: ItemEntry[];
  path: string;
  name: string;
  ctx: EditContext;
}) {
  const first = items[0]!;
  const rows = leafPaths(first.value, '', name, `${path}/${first.seg}`).filter(() => true);
  const effective = (seg: string, rel: string, value: unknown) => {
    const p = `${path}/${seg}/${rel}`;
    return p in ctx.draft ? ctx.draft[p] : valueAt(value, rel);
  };
  return (
    <div className="ad-compare">
      <table>
        <thead>
          <tr>
            <th />
            {items.map(({ seg, value }) => (
              <th key={seg}>
                <span className="ad-compare__head">
                  <ItemHeader value={value} path={`${path}/${seg}`} ctx={ctx} />
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ rel, name: leafName }) => {
            const base = effective(first.seg, rel, first.value);
            return (
              <tr key={rel}>
                <th scope="row">
                  {rel.split('/').map(humanize).join(' › ')}
                  <Tip field={leafName} />
                </th>
                {items.map(({ seg, value }) => {
                  const def = valueAt(value, rel);
                  const leafPath = `${path}/${seg}/${rel}`;
                  const kind = choiceKind(leafPath) ?? leafKind(leafName, def);
                  const differs = !same(effective(seg, rel, value), base);
                  return (
                    <td
                      key={seg}
                      className={`${differs ? 'is-different' : ''}${leafPath in ctx.draft ? ' is-changed' : ''}`}
                    >
                      {kind && def !== undefined && (
                        <LeafEditor value={def} path={leafPath} name={leafName} kind={kind} ctx={ctx} />
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FormationNode({ value, path, ctx }: { value: Point[]; path: string; ctx: EditContext }) {
  const current = value.map((p, i) => (ctx.draft[`${path}/${i}`] as Point | undefined) ?? p);
  return (
    <FormationEditor
      value={current}
      defaults={value}
      pitch={ctx.pitch}
      onChange={(i, p) => ctx.onChange(`${path}/${i}`, p, value[i])}
    />
  );
}

interface LeafProps {
  value: unknown;
  path: string;
  name: string;
  kind: LeafKind;
  ctx: EditContext;
}

function LeafEditor({ value: def, path, name, kind, ctx }: LeafProps) {
  const current = path in ctx.draft ? ctx.draft[path] : def;
  const set = (v: unknown) => ctx.onChange(path, v, def);
  switch (kind) {
    case 'number':
      return <NumberInput value={current as number} step={stepFor(def as number)} onChange={set} />;
    case 'bool':
      return (
        <label className="ad-switch">
          <input type="checkbox" checked={current as boolean} onChange={(e) => set(e.target.checked)} />
          <span />
        </label>
      );
    case 'price':
      return <PriceInput value={current as Price | null} nullable={name === 'price'} onChange={set} />;
    case 'numbers':
      return <NumberList value={current as number[]} fixed={!isVariableList(name)} onChange={set} />;
    case 'prices':
      return <PriceList value={current as Price[]} onChange={set} />;
    case 'choice':
      return <ThemePicker value={current as string} onChange={set} />;
    case 'image':
      return null;
  }
}

/** Board look of an arena: one of the art themes, shown as thumbnails. */
export function ThemePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <span className="ad-themes" role="radiogroup">
      {ARENA_THEMES.map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={value === t}
          className={`ad-themes__opt${value === t ? ' is-active' : ''}`}
          onClick={() => onChange(t)}
        >
          {themePreviewUrl(t) && <img src={themePreviewUrl(t)} alt="" />}
          <span>{t}</span>
        </button>
      ))}
    </span>
  );
}

function LeafRow(props: LeafProps) {
  const { value: def, path, ctx } = props;
  const overridden = path in ctx.draft;
  const dirty = !same(ctx.draft[path], ctx.saved[path]);
  return (
    <div
      className={`ad-row${props.kind === 'choice' ? ' ad-row--block' : ''}${overridden ? ' is-changed' : ''}${dirty ? ' is-dirty' : ''}`}
    >
      <span className="ad-row__label" title={path}>
        {humanize(path.split('/').pop() ?? '')}
        <Tip field={props.name} />
        <small>{tr('value.default', { v: show(def) })}</small>
      </span>
      <span className="ad-row__editor">
        <LeafEditor {...props} />
      </span>
      <span className="ad-row__reset">
        {overridden && (
          <button
            type="button"
            className="admin__btn admin__btn--small"
            onClick={() => ctx.onChange(path, undefined, def)}
          >
            {tr('action.reset')}
          </button>
        )}
      </span>
    </div>
  );
}

export function NumberInput({ value, step, onChange }: { value: number; step: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const nudge = (dir: number) => onChange(Number((value + dir * step).toFixed(6)));
  return (
    <span className="ad-stepper">
      <button type="button" onClick={() => nudge(-1)} aria-label="Decrease">
        −
      </button>
      <input
        type="number"
        step="any"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value !== '' && Number.isFinite(Number(e.target.value))) onChange(Number(e.target.value));
        }}
        onBlur={() => setText(String(value))}
      />
      <button type="button" onClick={() => nudge(1)} aria-label="Increase">
        +
      </button>
    </span>
  );
}

function PriceInput({
  value,
  nullable,
  onChange,
}: {
  value: Price | null;
  nullable: boolean;
  onChange: (v: Price | null) => void;
}) {
  const update = (currency: 'coins' | 'gems', text: string) => {
    const next: Price = { ...(value ?? {}) };
    if (text === '') delete next[currency];
    else next[currency] = Math.max(0, Math.round(Number(text)) || 0);
    onChange(next);
  };
  return (
    <span className="ad-price">
      {nullable && (
        <label className="ad-price__free">
          <input
            type="checkbox"
            checked={value === null}
            onChange={(e) => onChange(e.target.checked ? null : { coins: 0 })}
          />
          {tr('price.free')}
        </label>
      )}
      {value !== null &&
        (['coins', 'gems'] as const).map((c) => (
          <label key={c} className={`ad-price__field ad-price__field--${c}`}>
            <input
              type="number"
              min={0}
              step={1}
              value={value[c] ?? ''}
              placeholder="—"
              onChange={(e) => update(c, e.target.value)}
            />
            <span>{tr(c === 'gems' ? 'price.gems' : 'price.coins')}</span>
          </label>
        ))}
    </span>
  );
}

function NumberList({ value, fixed, onChange }: { value: number[]; fixed: boolean; onChange: (v: number[]) => void }) {
  const [text, setText] = useState(value.join(', '));
  const [bad, setBad] = useState(false);
  useEffect(() => setText(value.join(', ')), [value]);
  const commit = () => {
    const parts = text.split(',').map((s) => Number(s.trim()));
    const ok = parts.length > 0 && parts.every(Number.isFinite) && (!fixed || parts.length === value.length);
    setBad(!ok);
    if (ok) onChange(parts);
  };
  return (
    <input
      className={`ad-list-input${bad ? ' is-bad' : ''}`}
      value={text}
      title={fixed ? `${value.length} numbers, comma separated` : 'Comma separated numbers'}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  );
}

function PriceList({ value, onChange }: { value: Price[]; onChange: (v: Price[]) => void }) {
  return (
    <span className="ad-days">
      {value.map((p, i) => (
        <span key={i} className="ad-days__day">
          <b>{tr('day', { n: num(i + 1) })}</b>
          <PriceInput
            value={p}
            nullable={false}
            onChange={(v) => onChange(value.map((x, j) => (j === i ? (v ?? {}) : x)))}
          />
          {value.length > 1 && (
            <button
              type="button"
              className="admin__btn admin__btn--small"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
              aria-label={`Remove day ${i + 1}`}
            >
              ×
            </button>
          )}
        </span>
      ))}
      <button type="button" className="admin__btn admin__btn--small" onClick={() => onChange([...value, { coins: 0 }])}>
        {tr('action.addDay')}
      </button>
    </span>
  );
}

interface VoiceReport {
  id: string;
  match_id: string;
  reporter: string;
  reported: string;
  reporterName: string;
  reportedName: string;
  reason: string;
  note: string;
  created_at: string;
}

function VoiceReports({ token, onSignOut }: { token: string; onSignOut: () => void }) {
  const [data, setData] = useState<{ enabled: boolean; reports: VoiceReport[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    rpc<{ enabled: boolean; reports: VoiceReport[] }>('admin_voice_reports', { token }).then(setData, async (err) => {
      if (err instanceof Response && err.status === 401) onSignOut();
      setError(await describeError(err));
    });
  }, [token, onSignOut]);
  const who = (name: string, id: string) => (name ? `${name} · ${id.slice(0, 8)}` : id.slice(0, 8));
  const reason = (r: string) =>
    ['spam', 'abuse', 'cheating', 'other'].includes(r) ? tr(`reports.reason.${r}` as AdminKey) : r;
  return (
    <div className="dash__cards">
      <section className="ad-card ad-card--wide">
        <h2>{tr('reports.title')}</h2>
        {error && <p className="admin__error">{error}</p>}
        {!data && !error && <p className="admin__note">{tr('conn.loading')}</p>}
        {data && !data.enabled && <p className="admin__note">{tr('reports.disabled')}</p>}
        {data && data.reports.length === 0 && <p className="admin__note">{tr('reports.empty')}</p>}
        {data && data.reports.length > 0 && (
          <div className="ad-compare ad-reports">
            <table>
              <thead>
                <tr>
                  <th>{tr('reports.when')}</th>
                  <th>{tr('reports.reported')}</th>
                  <th>{tr('reports.reason')}</th>
                  <th>{tr('reports.reporter')}</th>
                  <th>{tr('reports.note')}</th>
                  <th>{tr('reports.match')}</th>
                </tr>
              </thead>
              <tbody>
                {data.reports.map((r) => (
                  <tr key={r.id}>
                    <td data-label={tr('reports.when')}>{new Date(r.created_at).toLocaleString()}</td>
                    <td data-label={tr('reports.reported')}>
                      <bdi>{who(r.reportedName, r.reported)}</bdi>
                    </td>
                    <td data-label={tr('reports.reason')}>{reason(r.reason)}</td>
                    <td data-label={tr('reports.reporter')}>
                      <bdi>{who(r.reporterName, r.reporter)}</bdi>
                    </td>
                    <td data-label={tr('reports.note')}>
                      <bdi>{r.note || '—'}</bdi>
                    </td>
                    <td data-label={tr('reports.match')}>
                      <code>{r.match_id.slice(0, 8)}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function History({ entries, canReset, onReset }: { entries: AuditEntry[]; canReset: boolean; onReset: () => void }) {
  return (
    <div className="dash__cards">
      <section className="ad-card ad-card--wide">
        <h2>{tr('history.title')}</h2>
        {entries.length === 0 && <p className="admin__note">{tr('history.empty')}</p>}
        <ol className="ad-history">
          {[...entries]
            .sort((a, b) => b.revision - a.revision)
            .map((e) => (
              <li key={e.revision}>
                <div className="ad-history__head">
                  <b>Revision {e.revision}</b>
                  <span>{new Date(e.at * 1000).toLocaleString()}</span>
                  <span className="ad-history__by">{tr('history.by', { x: e.by.slice(0, 8) })}</span>
                </div>
                <ul>
                  {e.changes.map((c) => (
                    <li key={c.path}>
                      <code>{c.path}</code>
                      <span className="ad-history__from">{show(c.before)}</span>→
                      <span className="ad-history__to">{show(c.after)}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
        </ol>
      </section>
      <section className="ad-card ad-card--danger">
        <h2>{tr('danger.title')}</h2>
        <p className="admin__note">{tr('danger.body')}</p>
        <button type="button" className="admin__btn admin__btn--danger" disabled={!canReset} onClick={onReset}>
          {tr('danger.button')}
        </button>
      </section>
    </div>
  );
}

function FormationsPage({ ctx }: { ctx: EditContext }) {
  const kickoff = (ctx.defaults.rules as { formation: Point[] }).formation;
  const shop = (ctx.defaults.cosmetics as { formations: Record<string, unknown>[] }).formations;
  return (
    <div className="dash__cards">
      <section className="ad-card ad-card--wide">
        <h2>{tr('formations.shop')}</h2>
        <Node value={shop} path="cosmetics/formations" name="formations" depth={1} ctx={ctx} />
      </section>
      <section className="ad-card ad-card--wide">
        <h2>{tr('formations.kickoff')}</h2>
        <p className="admin__note">{tr('formations.kickoffNote')}</p>
        <Node value={kickoff} path="rules/formation" name="formation" depth={1} ctx={ctx} />
      </section>
    </div>
  );
}

const PHYSICS_SECTIONS: { id: Scenario; keys: string[] }[] = [
  { id: 'ball', keys: ['ball'] },
  { id: 'disc', keys: ['disc'] },
  { id: 'arena', keys: ['arena'] },
  { id: 'shot', keys: ['maxImpulse', 'minImpulse', 'maxStepsPerShot', 'boundsMargin'] },
];
const sectionLabel = (id: Scenario) => tr(`physics.${id}` as AdminKey);
const sectionHint = (id: Scenario) => tr(`physics.${id}.hint` as AdminKey);

/** Physics with a set of overrides applied over the defaults. */
function physicsWith(defaults: unknown, overrides: Overrides): PhysicsConfig {
  const docs = { physics: cloneJson(defaults) } as unknown as ConfigDocs;
  for (const [path, value] of Object.entries(overrides)) {
    if (!path.startsWith('physics/')) continue;
    const leaf = locate(docs, path);
    if (leaf) (leaf.parent as Record<string | number, unknown>)[leaf.key] = cloneJson(value);
  }
  return docs.physics as PhysicsConfig;
}

/** Physics by part: the parts on the left, their values and a live before/after preview on the right. */
function PhysicsPage({ ctx }: { ctx: EditContext }) {
  const [section, setSection] = useState<Scenario>('ball');
  const doc = ctx.defaults.physics as Record<string, unknown>;
  const before = useMemo(() => physicsWith(doc, ctx.saved), [doc, ctx.saved]);
  const after = useMemo(() => physicsWith(doc, ctx.draft), [doc, ctx.draft]);
  const current = PHYSICS_SECTIONS.find((s) => s.id === section)!;
  return (
    <div className="ad-browser">
      <div className="ad-browser__list" role="listbox" aria-label={tr('page.physics')}>
        {PHYSICS_SECTIONS.map((s) => {
          const changed = Object.keys(ctx.draft).filter((p) =>
            s.keys.some((k) => p === `physics/${k}` || p.startsWith(`physics/${k}/`)),
          ).length;
          return (
            <div
              key={s.id}
              role="option"
              aria-selected={section === s.id}
              tabIndex={0}
              className={`ad-browser__entry${section === s.id ? ' is-active' : ''}`}
              onClick={(e) => {
                setSection(s.id);
                revealDetail(e.currentTarget);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setSection(s.id);
              }}
            >
              <span className="ad-item__title">
                <b>{sectionLabel(s.id)}</b>
                <small>{sectionHint(s.id)}</small>
              </span>
              {changed > 0 && <span className="dash__badge">{changed}</span>}
            </div>
          );
        })}
      </div>
      <div className="ad-browser__detail">
        <div className="ad-detail">
          <div className="ad-detail__head">
            <span className="ad-item__title">
              <b>{sectionLabel(current.id)}</b>
              <small>{sectionHint(current.id)}</small>
            </span>
          </div>
          {current.keys.map((k) => (
            <Node key={k} value={doc[k]} path={`physics/${k}`} name={k} depth={1} ctx={ctx} />
          ))}
        </div>
        <PhysicsPreview before={before} after={after} scenario={current.id} />
      </div>
    </div>
  );
}

/** Info icon with the field's description as a tooltip (hover or keyboard focus). */
export function Tip({ field }: { field: string }) {
  const help = fieldHelp(field);
  if (!help) return null;
  return (
    <span className="ad-tip" tabIndex={0} role="note" aria-label={help} data-tip={help}>
      i
    </span>
  );
}

/** What a team's force / time / aim mean in play, before and after the draft, plus a full-power shot. */
function TeamPreview({ path, value, ctx }: { path: string; value: Record<string, unknown>; ctx: EditContext }) {
  const attrs = value.attributes as Record<'force' | 'time' | 'aim', number>;
  const pick = (o: Overrides, k: 'force' | 'time' | 'aim') =>
    (o[`${path}/attributes/${k}`] as number | undefined) ?? attrs[k];
  const before = { force: pick(ctx.saved, 'force'), time: pick(ctx.saved, 'time'), aim: pick(ctx.saved, 'aim') };
  const after = { force: pick(ctx.draft, 'force'), time: pick(ctx.draft, 'time'), aim: pick(ctx.draft, 'aim') };
  const doc = ctx.defaults.physics as Record<string, unknown>;
  const basePhysicsBefore = useMemo(() => physicsWith(doc, ctx.saved), [doc, ctx.saved]);
  const basePhysicsAfter = useMemo(() => physicsWith(doc, ctx.draft), [doc, ctx.draft]);
  const turnMs = (o: Overrides) =>
    (o['rules/turnTimeMs'] as number | undefined) ?? (ctx.defaults.rules as { turnTimeMs: number }).turnTimeMs;
  const physicsBefore = { ...basePhysicsBefore, maxImpulse: basePhysicsBefore.maxImpulse * forceScale(before.force) };
  const physicsAfter = { ...basePhysicsAfter, maxImpulse: basePhysicsAfter.maxImpulse * forceScale(after.force) };
  const rows: { key: 'force' | 'time' | 'aim'; label: string; b: string; a: string }[] = [
    {
      key: 'force',
      label: tr('team.power'),
      b: `${num(Math.round(forceScale(before.force) * 100))}%`,
      a: `${num(Math.round(forceScale(after.force) * 100))}%`,
    },
    {
      key: 'time',
      label: tr('team.turn'),
      b: tr('sim.seconds', { n: num(+((turnMs(ctx.saved) * timeScale(before.time)) / 1000).toFixed(1)) }),
      a: tr('sim.seconds', { n: num(+((turnMs(ctx.draft) * timeScale(after.time)) / 1000).toFixed(1)) }),
    },
    {
      key: 'aim',
      label: tr('team.aim'),
      b: `${num(Math.round((aimRange(before.aim) / aimRange(6)) * 100))}%`,
      a: `${num(Math.round((aimRange(after.aim) / aimRange(6)) * 100))}%`,
    },
  ];
  return (
    <div className="ad-team-preview">
      <div className="ad-detail__head">
        <span className="ad-item__title">
          <b>{tr('team.preview')}</b>
          <small>{tr('team.previewHint')}</small>
        </span>
      </div>
      <div className="ad-team-preview__bars">
        {rows.map((r) => (
          <div key={r.key} className={`ad-team-preview__row${r.a !== r.b ? ' is-different' : ''}`}>
            <span className="ad-team-preview__label">
              {r.label}
              <Tip field={r.key} />
            </span>
            <span className="ad-team-preview__bar" aria-hidden="true">
              <i className="is-before" style={{ inlineSize: `${before[r.key] * 10}%` }} />
              <i className="is-after" style={{ inlineSize: `${after[r.key] * 10}%` }} />
            </span>
            <span className="ad-team-preview__value">
              {r.a !== r.b && <s>{r.b}</s>} <b>{r.a}</b>
            </span>
          </div>
        ))}
      </div>
      <PhysicsPreview before={physicsBefore} after={physicsAfter} scenario="shot" />
    </div>
  );
}
