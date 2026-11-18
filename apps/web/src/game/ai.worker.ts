/// <reference lib="webworker" />
import {
  appliedConfig,
  applyConfigOverrides,
  physicsConfig,
  teamPhysics,
  type AIProfile,
  type Overrides,
} from '@flickkick/config';
import { decideShot, type MatchState, type Shot, type Side } from '@flickkick/rules';
import { FlickSim } from '@flickkick/sim';

export interface AIRequest {
  id: number;
  state: MatchState;
  side: Side;
  profile: AIProfile;
  seed: number;
  /** The page's balance overrides; the worker has its own copy of the config. */
  config: { revision: number; overrides: Overrides };
}

export type AIResponse =
  { id: number; ok: true; shot: Shot; simulations: number } | { id: number; ok: false; error: string };

let simPromise: Promise<FlickSim> | null = null;

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = async (e: MessageEvent<AIRequest>) => {
  const { id, state, side, profile, seed, config } = e.data;
  try {
    if (config.revision !== appliedConfig().revision) applyConfigOverrides(config.revision, config.overrides);
    simPromise ??= FlickSim.create(physicsConfig);
    const sim = await simPromise;
    const decision = decideShot(
      state,
      side,
      profile,
      sim,
      seed,
      teamPhysics(state.players[side === 'L' ? 0 : 1].teamId, physicsConfig),
    );
    scope.postMessage({ id, ok: true, shot: decision.shot, simulations: decision.simulations } satisfies AIResponse);
  } catch (err) {
    scope.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies AIResponse);
  }
};
