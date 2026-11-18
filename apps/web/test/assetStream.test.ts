import { describe, expect, it } from 'vitest';
import { createAssetStream, type AssetStreamOptions } from '../src/services/assetStream';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A stream whose downloads finish only when the test says so. */
function harness(overrides: Partial<AssetStreamOptions> = {}) {
  const started: string[] = [];
  const pending = new Map<string, () => void>();
  const stream = createAssetStream({
    fetchFile: (url) =>
      new Promise((resolve) => {
        started.push(url);
        pending.set(url, resolve);
      }),
    concurrency: 2,
    idleConcurrency: 1,
    timeoutMs: 1_000,
    retries: 1,
    backoffMs: 1,
    ...overrides,
  });
  return { stream, started, finish: (url: string) => pending.get(url)?.() };
}

describe('asset stream', () => {
  it('serves urgent files before queued background files', async () => {
    const { stream, started, finish } = harness({ concurrency: 1 });
    void stream.request(['first', 'idle-b'], 'idle');
    void stream.request(['urgent'], 'now');
    finish('first');
    await tick();
    expect(started).toEqual(['first', 'urgent']);
  });

  it('keeps part of the bandwidth free of background files', () => {
    const { stream, started } = harness();
    void stream.request(['a', 'b', 'c'], 'idle');
    expect(started).toEqual(['a']);
  });

  it('raises the priority of a file that is requested again', async () => {
    const { stream, started, finish } = harness({ concurrency: 1 });
    void stream.request(['first', 'later', 'wanted'], 'soon');
    void stream.request(['wanted'], 'now');
    finish('first');
    await tick();
    expect(started).toEqual(['first', 'wanted']);
  });

  it('holds background files while paused', async () => {
    const { stream, started } = harness();
    stream.setIdlePaused(true);
    void stream.request(['a'], 'idle');
    expect(started).toEqual([]);
    stream.setIdlePaused(false);
    await tick();
    expect(started).toEqual(['a']);
  });

  it('reports progress and never downloads a finished file twice', async () => {
    const { stream, started, finish } = harness();
    const seen: number[] = [];
    const done = stream.request(['a', 'b'], 'now', (count) => seen.push(count));
    finish('a');
    finish('b');
    await done;
    expect(seen).toEqual([0, 1, 2]);
    await stream.request(['a'], 'now');
    expect(started).toEqual(['a', 'b']);
  });

  it('retries a failed file and resolves even when it never loads', async () => {
    let attempts = 0;
    const stream = createAssetStream({
      fetchFile: async () => {
        attempts++;
        throw new Error('offline');
      },
      concurrency: 2,
      idleConcurrency: 1,
      timeoutMs: 1_000,
      retries: 2,
      backoffMs: 1,
    });
    await stream.request(['missing'], 'now');
    expect(attempts).toBe(3);
  });

  it('abandons a stalled download and tries again', async () => {
    let attempts = 0;
    const stream = createAssetStream({
      fetchFile: (_url, signal) =>
        new Promise((resolve, reject) => {
          attempts++;
          if (attempts > 1) resolve();
          signal.addEventListener('abort', () => reject(new Error('stalled')));
        }),
      concurrency: 2,
      idleConcurrency: 1,
      timeoutMs: 5,
      retries: 1,
      backoffMs: 1,
    });
    await stream.request(['slow'], 'now');
    expect(attempts).toBe(2);
  });
});
