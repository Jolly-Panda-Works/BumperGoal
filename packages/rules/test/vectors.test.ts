import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { physicsConfig, rulesConfig } from '@flickkick/config';
import { FlickSim } from '@flickkick/sim';
import {
  Rng,
  applyShotResult,
  applyTimeout,
  createMatch,
  impulseFromAim,
  mixSeed,
  type MatchState,
} from '../src/index';

// Shared rules vectors: the Go server (server/nakama/rules) replays these
// action scripts with its own rules + Rapier and must reach the same states.
const VECTORS = fileURLToPath(new URL('./vectors.json', import.meta.url));

type Action = { type: 'shot'; discIndex: number; ix: number; iy: number } | { type: 'timeout' };

interface Snapshot {
  phase: string;
  turn: MatchState['turn'];
  score: MatchState['score'];
  shotCount: number;
  suddenDeath: boolean;
  result: MatchState['result'];
  stateHash: string;
  events: string[];
}

function snapshot(s: MatchState, events: { type: string }[]): Snapshot {
  return {
    phase: s.phase,
    turn: s.turn,
    score: s.score,
    shotCount: s.shotCount,
    suddenDeath: s.suddenDeath,
    result: s.result,
    stateHash: s.stateHash,
    events: events.map((e) => e.type),
  };
}

/** Deterministic pseudo-random scripts: mostly shots at the ball, some timeouts. */
function script(
  seed: number,
  length: number,
  sim: FlickSim,
): { seed: number; actions: Action[]; snapshots: Snapshot[] } {
  const rng = new Rng(mixSeed(seed, 77));
  let state = createMatch({
    matchId: `vec-${seed}`,
    mode: 'online',
    rngSeed: seed,
    rules: rulesConfig,
    players: [
      { id: 'a', displayName: 'A', level: 1, teamId: 'team_volt', isBot: false },
      { id: 'b', displayName: 'B', level: 1, teamId: 'team_coral', isBot: false },
    ],
  });
  const actions: Action[] = [];
  const snapshots: Snapshot[] = [];
  for (let i = 0; i < length && state.phase !== 'ENDED'; i++) {
    if (rng.next() < 0.12) {
      actions.push({ type: 'timeout' });
      const r = applyTimeout(state);
      state = r.state;
      snapshots.push(snapshot(state, r.events));
      continue;
    }
    const side = state.turn.side;
    const base = side === 'L' ? 0 : state.discsPerTeam;
    const discIndex = base + Math.floor(rng.next() * state.discsPerTeam);
    const disc = state.bodies[discIndex]!;
    const ball = state.bodies.at(-1)!;
    const angle = Math.atan2(ball.y - disc.y, ball.x - disc.x) + (rng.next() - 0.5) * 0.6;
    const { ix, iy } = impulseFromAim(angle, 0.4 + rng.next() * 0.6, physicsConfig);
    actions.push({ type: 'shot', discIndex, ix, iy });
    const shot = { seq: state.turn.seq, discIndex, ix, iy };
    const result = sim.simulateShot(state.bodies, { bodyIndex: discIndex, ix, iy });
    const r = applyShotResult(state, side, shot, result, rulesConfig);
    state = r.state;
    snapshots.push(snapshot(state, r.events));
  }
  return { seed, actions, snapshots };
}

let sim: FlickSim;
beforeAll(async () => {
  sim = await FlickSim.create(physicsConfig);
});

describe('rules vectors for the Go server', () => {
  it('match vectors.json (regenerate with UPDATE_VECTORS=1)', { timeout: 120_000 }, () => {
    const scripts = [11, 23, 37, 41, 59].map((seed) => script(seed, 70, sim));
    if (process.env.UPDATE_VECTORS === '1' || !existsSync(VECTORS)) {
      writeFileSync(VECTORS, `${JSON.stringify({ rules: rulesConfig, scripts }, null, 1)}\n`);
    }
    const expected = JSON.parse(readFileSync(VECTORS, 'utf8')) as { rules: unknown; scripts: typeof scripts };
    expect(expected.rules, 'rules.json changed: regenerate vectors').toEqual(rulesConfig);
    expect(scripts).toEqual(expected.scripts);
    // The scripts must exercise the interesting paths.
    const all = scripts.flatMap((s) => s.snapshots.flatMap((x) => x.events));
    for (const t of ['shot', 'goal', 'turn', 'timeout', 'ended']) expect(all, t).toContain(t);
  });
});
