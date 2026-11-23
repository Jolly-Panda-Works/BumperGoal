// Base load and streaming for the running app. See services/assetStream.ts.
import { assetUrl, themeOf, uiUrl } from '../game/art';
import { baseBundle, idleBundle, matchBundle, screenBundle } from '../game/assetBundles';
import { createAssetStream } from './assetStream';

/** A stalled file must not hold the game back: the boot screen gives up waiting after this. */
const BASE_WAIT_MS = 6_000;

const stream = createAssetStream({
  fetchFile: async (url, signal) => {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    await response.blob();
  },
  concurrency: 6,
  idleConcurrency: 2,
  timeoutMs: 12_000,
  retries: 2,
  backoffMs: 1_000,
});

const urls = (files: string[]) => files.map(assetUrl);

/** The same choice as the <picture> on the welcome screen. */
function welcomePromo(): string | undefined {
  const url = window.matchMedia('(max-aspect-ratio: 4/3)').matches ? uiUrl('promo_square') : uiUrl('promo_landscape');
  return url?.slice(assetUrl('').length);
}

export function loadBaseAssets(welcomed: boolean, onProgress: (share: number) => void): Promise<void> {
  const base = stream.request(urls(baseBundle(welcomed ? undefined : welcomePromo())), 'now', (done, total) =>
    onProgress(total ? done / total : 1),
  );
  return Promise.race([base, new Promise<void>((resolve) => setTimeout(resolve, BASE_WAIT_MS))]);
}

export function streamScreenAssets(pathname: string): void {
  void stream.request(urls(screenBundle(pathname)), 'soon');
}

export function streamMatchAssets(
  arena: string | undefined,
  teamIds: string[],
  ballId: string,
  avatarIds: string[],
): void {
  void stream.request(urls(matchBundle(themeOf(arena), teamIds, ballId, avatarIds)), 'now');
}

interface NetworkInformation {
  saveData?: boolean;
  effectiveType?: string;
}

/** Background files spend the player's data, so slow or metered connections skip them. */
export function startBackgroundAssets(): void {
  const network = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  if (network?.saveData || network?.effectiveType?.endsWith('2g')) return;
  void stream.request(urls(idleBundle()), 'idle');
}

export const pauseBackgroundAssets = (paused: boolean): void => stream.setIdlePaused(paused);
