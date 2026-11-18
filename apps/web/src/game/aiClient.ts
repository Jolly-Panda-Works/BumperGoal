// Runs AI decisions in a Web Worker so the 12–180 physics predictions per turn
// never block rendering. Falls back to the main thread if workers are unavailable.
import { appliedConfig, teamPhysics, type AIProfile } from '@flickkick/config';
import type { FlickSim } from '@flickkick/sim';
import { decideShot, type MatchState, type Shot, type Side } from '@flickkick/rules';
import type { AIRequest, AIResponse } from './ai.worker';

export interface AIClient {
  decide(state: MatchState, side: Side, profile: AIProfile, seed: number): Promise<Shot>;
  dispose(): void;
}

export function createAIClient(fallbackSim: FlickSim): AIClient {
  let worker: Worker | null = null;
  let nextId = 1;
  const pending = new Map<number, { resolve: (s: Shot) => void; reject: (e: Error) => void }>();

  try {
    worker = new Worker(new URL('./ai.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<AIResponse>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data.shot);
      else p.reject(new Error(e.data.error));
    };
    worker.onerror = () => {
      pending.forEach((p) => p.reject(new Error('AI worker failed')));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  } catch {
    worker = null;
  }

  const local = (state: MatchState, side: Side, profile: AIProfile, seed: number) =>
    decideShot(
      state,
      side,
      profile,
      fallbackSim,
      seed,
      teamPhysics(state.players[side === 'L' ? 0 : 1].teamId, fallbackSim.config),
    ).shot;

  return {
    decide(state, side, profile, seed) {
      if (!worker) return Promise.resolve().then(() => local(state, side, profile, seed));
      const id = nextId++;
      const request: AIRequest = { id, state, side, profile, seed, config: appliedConfig() };
      return new Promise<Shot>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker!.postMessage(request);
      }).catch(() => local(state, side, profile, seed));
    },
    dispose() {
      worker?.terminate();
      worker = null;
      pending.clear();
    },
  };
}
