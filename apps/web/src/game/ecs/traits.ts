// Koota ECS traits for the match runtime.
//
// The canonical, serializable match state stays a plain MatchState (it is what
// the server validates and sends); the ECS world holds it as a world trait and
// projects it onto entities that systems animate and Phaser renders.
//
// Every trait with data uses Koota's callback (AoS) form. Schema (SoA) traits
// make Koota generate accessors with `new Function`, which the production
// Content-Security-Policy (no 'unsafe-eval') blocks. See test/ecs-csp.test.ts.
import { trait } from 'koota';
import type { MatchEvent, MatchState, Shot, Side } from '@flickkick/rules';

// ---------- world traits (singletons) ----------

/** Canonical rules state, written only by the MatchController. */
export const MatchTrait = trait(() => ({ state: null as MatchState | null }));

/** HUD-facing derived state. */
export const HudTrait = trait(() => ({
  thinkingSide: null as Side | null,
  turnEndsAt: null as number | null,
  paused: false,
  /** True while this device may aim (human turn, awaiting a shot, not paused). */
  canAim: false,
  /** Online only: the realtime connection dropped and is being restored. */
  reconnecting: false,
}));

/** Last batch of rules events, for HUD banners. */
export const EventsTrait = trait(() => ({ events: [] as MatchEvent[], serial: 0 }));

/** Recorded physics frames being played back. */
export const PlaybackTrait = trait(() => ({
  active: false,
  side: 'L' as Side,
  shot: null as Shot | null,
  frames: new Float32Array(0) as Float32Array<ArrayBufferLike>,
  bodyCount: 0,
  ticks: 0,
  elapsedMs: 0,
  /** Last whole frame already processed for impact detection. */
  lastFrame: 0,
}));

/** Board stays frozen (e.g. ball in the net) until this time (ms, scene clock). */
export const HoldTrait = trait(() => ({ until: 0 }));

// ---------- entity traits ----------

/** Index of the body in MatchState.bodies and in the physics world. */
export const BodyRef = trait(() => ({ index: 0 }));
export const IsDisc = trait();
export const IsBall = trait();
export const Team = trait(() => ({ side: 'L' as Side }));

/** Rendered position in board units. */
export const Position = trait(() => ({ x: 0, y: 0 }));
/** Where the canonical state says the body is; Position eases towards it. */
export const Target = trait(() => ({ x: 0, y: 0 }));

/** The disc belongs to the side whose turn it is. */
export const Highlighted = trait();
/** The disc is being aimed by local input. */
export const Aiming = trait(() => ({ angle: 0, power: 0, pointerId: -1 }));

/** Phaser display objects (AoS: plain object references). */
export const View = trait(() => ({ sprite: null as unknown, shadow: null as unknown, roll: undefined as unknown }));
