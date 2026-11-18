import { screenPreview } from '../dev/mode';

const storageKey = (key: string) => (screenPreview ? `screens.${key}` : key);
// localStorage access that never throws (private mode, blocked storage, quota).

export function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(storageKey(key));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(storageKey(key), JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key: string): void {
  try {
    window.localStorage.removeItem(storageKey(key));
  } catch {
    // ignore
  }
}

/** Minimal observable store used by settings and the local profile. */
export class Store<T extends object> {
  private listeners = new Set<() => void>();
  private value: T;

  constructor(
    private readonly key: string,
    private readonly defaults: T,
    private readonly migrate: (raw: Partial<T>) => T = (raw) => ({ ...defaults, ...raw }),
  ) {
    const stored = readJson<Partial<T>>(key);
    this.value = stored ? this.migrate(stored) : defaults;
  }

  get = (): T => this.value;

  set(patch: Partial<T> | ((current: T) => T)): void {
    this.value = typeof patch === 'function' ? patch(this.value) : { ...this.value, ...patch };
    writeJson(this.key, this.value);
    this.listeners.forEach((l) => l());
  }

  reset(): void {
    this.value = this.defaults;
    removeKey(this.key);
    this.listeners.forEach((l) => l());
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}
