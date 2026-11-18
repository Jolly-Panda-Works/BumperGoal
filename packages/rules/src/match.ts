// Pure match rules. No I/O, no timers, no physics calls: the caller simulates a
// validated shot and feeds the ShotResult back in. The Go server mirrors this
// file and both are checked against shared test vectors.
import type { PhysicsConfig, RulesConfig } from '@flickkick/config';
import { SIM_VERSION, hashBodies, toF32Bodies, type BodyState, type ShotResult } from '@flickkick/sim';
import { Rng } from './rng';
import {
  PROTOCOL_VERSION,
  otherSide,
  type EndReason,
  type MatchEvent,
  type MatchMode,
  type MatchState,
  type PlayerInfo,
  type Shot,
  type ShotRejection,
  type Side,
} from './types';

export interface CreateMatchInput {
  matchId: string;
  mode: MatchMode;
  players: [Omit<PlayerInfo, 'side'>, Omit<PlayerInfo, 'side'>];
  rngSeed: number;
  rules: RulesConfig;
}

/** Kickoff layout: both formations in their own half, ball on the centre spot. */
export function kickoffBodies(rules: RulesConfig): BodyState[] {
  const formation = rules.formation.slice(0, rules.discsPerTeam);
  if (formation.length !== rules.discsPerTeam) throw new Error('formation has fewer positions than discsPerTeam');
  const left = formation.map(([x, y]) => ({ kind: 'disc' as const, x, y }));
  const right = (rules.opponentFormation ?? formation)
    .slice(0, rules.discsPerTeam)
    .map(([x, y]) => ({ kind: 'disc' as const, x: -x, y }));
  return toF32Bodies([...left, ...right, { kind: 'ball', x: 0, y: 0 }]);
}

export function createMatch(input: CreateMatchInput): MatchState {
  const { rules } = input;
  const bodies = kickoffBodies(rules);
  // Coin toss for the first kickoff, derived from the seed.
  const firstSide: Side = new Rng(input.rngSeed).next() < 0.5 ? 'L' : 'R';
  return {
    protocolVersion: PROTOCOL_VERSION,
    simVersion: SIM_VERSION,
    matchId: input.matchId,
    mode: input.mode,
    players: [
      { ...input.players[0], side: 'L' },
      { ...input.players[1], side: 'R' },
    ],
    phase: 'AWAIT_SHOT',
    turn: { index: 0, side: firstSide, seq: 1 },
    bodies,
    discsPerTeam: rules.discsPerTeam,
    score: { L: 0, R: 0 },
    goalsToWin: rules.goalsToWin,
    shotCount: 0,
    maxShots: rules.maxShots,
    suddenDeath: false,
    consecutiveTimeouts: { L: 0, R: 0 },
    timeoutForfeitCount: rules.timeoutForfeitCount,
    rngSeed: input.rngSeed >>> 0,
    result: null,
    stateHash: hashBodies(bodies),
  };
}

export function ballIndex(state: MatchState): number {
  return state.bodies.length - 1;
}

export function discOwner(state: MatchState, index: number): Side | null {
  if (!Number.isInteger(index) || index < 0) return null;
  if (index < state.discsPerTeam) return 'L';
  if (index < state.discsPerTeam * 2) return 'R';
  return null;
}

export function discIndicesOf(state: MatchState, side: Side): number[] {
  const start = side === 'L' ? 0 : state.discsPerTeam;
  return Array.from({ length: state.discsPerTeam }, (_, i) => start + i);
}

export function playerOf(state: MatchState, side: Side): PlayerInfo {
  return side === 'L' ? state.players[0] : state.players[1];
}

/** Converts an aim angle (radians) and power in [0, 1] into an f32 impulse. */
export function impulseFromAim(angle: number, power: number, physics: PhysicsConfig): { ix: number; iy: number } {
  const p = Math.min(1, Math.max(0, power));
  const magnitude = Math.max(physics.minImpulse, p * physics.maxImpulse);
  return { ix: Math.fround(Math.cos(angle) * magnitude), iy: Math.fround(Math.sin(angle) * magnitude) };
}

const MAGNITUDE_TOLERANCE = 1e-4;

export function validateShot(
  state: MatchState,
  side: Side,
  shot: Shot,
  physics: PhysicsConfig,
): { ok: true } | { ok: false; reason: ShotRejection } {
  const reject = (reason: ShotRejection) => ({ ok: false as const, reason });
  if (state.phase === 'ENDED') return reject('match_ended');
  if (state.phase !== 'AWAIT_SHOT') return reject('not_awaiting_shot');
  if (state.turn.side !== side) return reject('not_your_turn');
  if (shot.seq !== state.turn.seq) return reject('stale_seq');
  const owner = discOwner(state, shot.discIndex);
  if (owner === null) return reject('invalid_disc');
  if (owner !== side) return reject('not_your_disc');
  if (!Number.isFinite(shot.ix) || !Number.isFinite(shot.iy)) return reject('non_finite');
  const magnitude = Math.hypot(shot.ix, shot.iy);
  if (
    magnitude < physics.minImpulse * (1 - MAGNITUDE_TOLERANCE) ||
    magnitude > physics.maxImpulse * (1 + MAGNITUDE_TOLERANCE)
  ) {
    return reject('power_out_of_range');
  }
  return { ok: true };
}

/** Marks the state as simulating a validated shot (locks further input). */
export function beginShot(state: MatchState): MatchState {
  return { ...state, phase: 'SIMULATING' };
}

function nextTurn(state: MatchState, side: Side): MatchState['turn'] {
  return { index: state.turn.index + 1, side, seq: state.turn.seq + 1 };
}

function end(state: MatchState, winner: Side, reason: EndReason, events: MatchEvent[]): MatchState {
  const result = { winner, reason };
  events.push({ type: 'ended', result, score: { ...state.score } });
  return { ...state, phase: 'ENDED', result };
}

/**
 * Applies the simulated outcome of a validated shot taken by `side`.
 * The caller must have simulated `shot` on `state.bodies`.
 */
export function applyShotResult(
  state: MatchState,
  side: Side,
  shot: Shot,
  result: ShotResult,
  rules: RulesConfig,
): { state: MatchState; events: MatchEvent[] } {
  const events: MatchEvent[] = [{ type: 'shot', side, shot }];

  if (result.outcome === 'invalid') {
    // Roll back to the pre-shot state; the turn is not consumed but the seq advances.
    events.push({ type: 'invalid_simulation', side });
    return {
      state: { ...state, phase: 'AWAIT_SHOT', turn: { ...state.turn, seq: state.turn.seq + 1 } },
      events,
    };
  }

  let next: MatchState = {
    ...state,
    shotCount: state.shotCount + 1,
    consecutiveTimeouts: { ...state.consecutiveTimeouts, [side]: 0 },
  };

  if (result.outcome === 'goal_left' || result.outcome === 'goal_right') {
    // Ball in the right goal means L scored, and vice versa.
    const scorer: Side = result.outcome === 'goal_right' ? 'L' : 'R';
    const score = { ...next.score, [scorer]: next.score[scorer] + 1 };
    next = { ...next, score };
    events.push({ type: 'goal', scorer, ownGoal: scorer !== side, score: { ...score } });
    if (score[scorer] >= next.goalsToWin || next.suddenDeath) {
      return {
        state: end({ ...next, bodies: result.bodies, stateHash: result.hash }, scorer, 'goals', events),
        events,
      };
    }
    const bodies = kickoffBodies(rules);
    const conceding = otherSide(scorer);
    next = { ...next, bodies, stateHash: hashBodies(bodies), turn: nextTurn(next, conceding), phase: 'AWAIT_SHOT' };
  } else {
    next = {
      ...next,
      bodies: result.bodies,
      stateHash: result.hash,
      turn: nextTurn(next, otherSide(side)),
      phase: 'AWAIT_SHOT',
    };
  }

  if (next.shotCount >= next.maxShots && !next.suddenDeath) {
    if (next.score.L !== next.score.R) {
      return { state: end(next, next.score.L > next.score.R ? 'L' : 'R', 'max_shots', events), events };
    }
    next = { ...next, suddenDeath: true };
    events.push({ type: 'sudden_death' });
  }

  events.push({ type: 'turn', side: next.turn.side, index: next.turn.index });
  return { state: next, events };
}

/** The active player's turn timer expired. */
export function applyTimeout(state: MatchState): { state: MatchState; events: MatchEvent[] } {
  if (state.phase !== 'AWAIT_SHOT') return { state, events: [] };
  const side = state.turn.side;
  const consecutive = state.consecutiveTimeouts[side] + 1;
  const events: MatchEvent[] = [{ type: 'timeout', side, consecutive }];
  const next = { ...state, consecutiveTimeouts: { ...state.consecutiveTimeouts, [side]: consecutive } };
  if (consecutive >= state.timeoutForfeitCount) {
    return { state: end(next, otherSide(side), 'forfeit_timeouts', events), events };
  }
  const turned = { ...next, turn: nextTurn(next, otherSide(side)) };
  events.push({ type: 'turn', side: turned.turn.side, index: turned.turn.index });
  return { state: turned, events };
}

export function forfeit(
  state: MatchState,
  side: Side,
  reason: 'forfeit_quit' | 'forfeit_disconnect',
): {
  state: MatchState;
  events: MatchEvent[];
} {
  if (state.phase === 'ENDED') return { state, events: [] };
  const events: MatchEvent[] = [];
  return { state: end(state, otherSide(side), reason, events), events };
}
