// Images uploaded in the admin panel ("asset:<sha256>"). Each is downloaded once
// with asset_get, kept in the Cache API for later visits, and served to the game
// and the UI as a blob: URL. Lookups are synchronous; until an image is ready the
// caller falls back to the bundled art.
import { useSyncExternalStore } from 'react';
import { arenasConfig } from '@flickkick/config';

const CACHE = 'flickkick-assets-v1';
const urls = new Map<string, string>();
const pending = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
let version = 0;

const idOf = (ref: string): string | null => (/^asset:[0-9a-f]{64}$/.test(ref) ? ref.slice(6) : null);
const cacheKey = (id: string) => `/__flickkick_asset/${id}`;

function publish(id: string, blob: Blob): void {
  if (!urls.has(id)) urls.set(id, URL.createObjectURL(blob));
  version++;
  listeners.forEach((l) => l());
}

/** blob: URL of an uploaded image, or undefined while it is not loaded. */
export function assetRefUrl(ref: string | undefined): string | undefined {
  const id = ref && idOf(ref);
  return id ? urls.get(id) : undefined;
}

/** Re-renders when uploaded images finish loading. */
export function useAssetsVersion(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
}

/** Makes an image uploaded in this browser available at once (the admin panel). */
export function registerAsset(ref: string, dataUrl: string): void {
  const id = idOf(ref);
  if (!id) return;
  // Decoded by hand: the CSP does not allow fetch() of data: URLs.
  const [head = '', b64 = ''] = dataUrl.split(';base64,');
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: head.replace(/^data:/, '') });
  publish(id, blob);
  if (typeof caches !== 'undefined') {
    void caches
      .open(CACHE)
      .then((c) => c.put(cacheKey(id), new Response(blob)))
      .catch(() => undefined);
  }
}

export interface FetchedAsset {
  mime: string;
  data: string;
}

/** Loads the given images from the device cache, else from the server. */
export function ensureAssets(refs: string[], fetchAsset?: (id: string) => Promise<FetchedAsset>): Promise<void> {
  const jobs = refs.map((ref) => {
    const id = idOf(ref);
    if (!id || urls.has(id)) return Promise.resolve();
    const running = pending.get(id);
    if (running) return running;
    const job = (async () => {
      const cache = typeof caches !== 'undefined' ? await caches.open(CACHE).catch(() => null) : null;
      const hit = await cache?.match(cacheKey(id));
      if (hit) {
        publish(id, await hit.blob());
        return;
      }
      if (!fetchAsset) return;
      const asset = await fetchAsset(id);
      const bytes = Uint8Array.from(atob(asset.data), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: asset.mime });
      await cache?.put(cacheKey(id), new Response(blob)).catch(() => undefined);
      publish(id, blob);
    })()
      .catch(() => undefined)
      .finally(() => pending.delete(id));
    pending.set(id, job);
    return job;
  });
  return Promise.all(jobs).then(() => undefined);
}

/** Every uploaded image the current config refers to. */
export function configAssetRefs(): string[] {
  return arenasConfig.arenas.flatMap((a) => Object.values(a.art ?? {}).map((img) => img.src));
}
