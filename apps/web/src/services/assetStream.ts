// A priority queue for art downloads. Finished files sit in the browser's HTTP
// cache, so <img>, CSS backgrounds and Phaser all pick them up from there.
// Downloads never reject: every caller keeps its own placeholder for a missing file.

export type AssetPriority = 'now' | 'soon' | 'idle';

const RANK: Record<AssetPriority, number> = { now: 0, soon: 1, idle: 2 };

export interface AssetStreamOptions {
  fetchFile: (url: string, signal: AbortSignal) => Promise<void>;
  /** Parallel downloads overall, and the part of them background files may use. */
  concurrency: number;
  idleConcurrency: number;
  timeoutMs: number;
  retries: number;
  backoffMs: number;
}

interface Job {
  url: string;
  rank: number;
  done: Promise<void>;
  finish: () => void;
}

export interface AssetStream {
  /** Queues the files; resolves once each one has loaded or used up its retries. */
  request(urls: string[], priority: AssetPriority, onProgress?: (done: number, total: number) => void): Promise<void>;
  /** Holds back background files, e.g. during a match. */
  setIdlePaused(paused: boolean): void;
}

export function createAssetStream(options: AssetStreamOptions): AssetStream {
  const jobs = new Map<string, Job>();
  const queue: Job[] = [];
  const loaded = new Set<string>();
  let active = 0;
  let idlePaused = false;

  const nextIndex = () => {
    let best = -1;
    queue.forEach((job, i) => {
      if (best < 0 || job.rank < queue[best]!.rank) best = i;
    });
    return best;
  };

  const download = async (url: string) => {
    for (let attempt = 0; attempt <= options.retries; attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, options.backoffMs * attempt));
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), options.timeoutMs);
      try {
        await options.fetchFile(url, abort.signal);
        return true;
      } catch {
        // Stalled or failed: try again.
      } finally {
        clearTimeout(timeout);
      }
    }
    return false;
  };

  const run = (job: Job) => {
    active++;
    void download(job.url).then((ok) => {
      active--;
      jobs.delete(job.url);
      if (ok) loaded.add(job.url);
      job.finish();
      pump();
    });
  };

  const pump = () => {
    while (active < options.concurrency) {
      const index = nextIndex();
      if (index < 0) return;
      const job = queue[index]!;
      if (job.rank === RANK.idle && (idlePaused || active >= options.idleConcurrency)) return;
      queue.splice(index, 1);
      run(job);
    }
  };

  const enqueue = (url: string, rank: number): Promise<void> => {
    const existing = jobs.get(url);
    if (existing) {
      existing.rank = Math.min(existing.rank, rank); // Needed sooner than first thought.
      return existing.done;
    }
    let finish = () => {};
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const job: Job = { url, rank, done, finish };
    jobs.set(url, job);
    queue.push(job);
    return done;
  };

  return {
    request(urls, priority, onProgress) {
      const wanted = [...new Set(urls)].filter((url) => !loaded.has(url));
      let finished = 0;
      onProgress?.(0, wanted.length);
      const all = wanted.map((url) =>
        enqueue(url, RANK[priority]).then(() => {
          finished++;
          onProgress?.(finished, wanted.length);
        }),
      );
      pump();
      return Promise.all(all).then(() => undefined);
    },
    setIdlePaused(paused) {
      idlePaused = paused;
      pump();
    },
  };
}
