import { beforeAll, describe, expect, it } from 'vitest';
import { aiProfiles, physicsConfig, rulesConfig } from '@flickkick/config';
import { FlickSim, toF32Bodies } from '@flickkick/sim';
import {
  Rng,
  applyShotResult,
  createMatch,
  decideShot,
  profileById,
  profileForLevel,
  validateShot,
  type MatchState,
  type Side,
} from '../src/index';

let sim: FlickSim;
beforeAll(async () => {
  sim = await FlickSim.create(physicsConfig);
});

function match(seed: number, side: Side): MatchState {
  const s = createMatch({
    matchId: `ai-${seed}`,
    mode: 'local_ai',
    rngSeed: seed,
    rules: rulesConfig,
    players: [
      { id: 'p', displayName: 'P', level: 1, teamId: 'team_volt', isBot: false },
      { id: 'bot', displayName: 'FlickBot', level: 1, teamId: 'team_coral', isBot: true },
    ],
  });
  return { ...s, turn: { ...s.turn, side } };
}

/** Random but reproducible mid-game boards. */
function randomBoard(seed: number, side: Side): MatchState {
  const rng = new Rng(seed);
  const s = match(seed, side);
  const a = physicsConfig.arena;
  const bodies = s.bodies.map((b) => ({
    kind: b.kind,
    x: (rng.next() * 2 - 1) * (a.halfWidth - 1),
    y: (rng.next() * 2 - 1) * (a.halfHeight - 1),
  }));
  // Spread overlapping bodies apart deterministically.
  for (let i = 0; i < bodies.length; i++) {
    for (let j = 0; j < i; j++) {
      if (Math.hypot(bodies[i]!.x - bodies[j]!.x, bodies[i]!.y - bodies[j]!.y) < 1)
        bodies[i]!.y = -bodies[i]!.y * 0.5 + 0.9;
    }
  }
  return { ...s, bodies: toF32Bodies(bodies) };
}

describe('difficulty mapping', () => {
  it.each([
    [1, 'rookie'],
    [3, 'rookie'],
    [4, 'amateur'],
    [8, 'amateur'],
    [9, 'pro'],
    [15, 'pro'],
    [16, 'elite'],
    [50, 'elite'],
    [0, 'rookie'],
  ])('level %i → %s', (level, id) => {
    expect(profileForLevel(level).id).toBe(id);
  });

  it('profiles get strictly stronger with level', () => {
    const sorted = [...aiProfiles].sort((a, b) => a.minLevel - b.minLevel);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.maxSimulations).toBeGreaterThan(sorted[i - 1]!.maxSimulations);
      expect(sorted[i]!.aimErrorDeg).toBeLessThan(sorted[i - 1]!.aimErrorDeg);
      expect(sorted[i]!.powerError).toBeLessThan(sorted[i - 1]!.powerError);
      expect(sorted[i]!.defensiveWeight).toBeGreaterThan(sorted[i - 1]!.defensiveWeight);
    }
  });
});

describe('AI decisions', () => {
  it.each(aiProfiles.map((p) => [p.id, p] as const))(
    '%s produces valid shots within its budget',
    { timeout: 60_000 },
    (_id, profile) => {
      for (let seed = 1; seed <= 6; seed++) {
        for (const side of ['L', 'R'] as const) {
          const state = randomBoard(seed * 31, side);
          const d = decideShot(state, side, profile, sim, seed);
          expect(validateShot(state, side, d.shot, physicsConfig)).toEqual({ ok: true });
          expect(d.simulations).toBeLessThanOrEqual(profile.maxSimulations);
        }
      }
    },
  );

  it('is deterministic for the same state and seed', () => {
    const state = randomBoard(99, 'R');
    const elite = profileById('elite');
    const a = decideShot(state, 'R', elite, sim, 1234);
    const b = decideShot(state, 'R', elite, sim, 1234);
    expect(b).toEqual(a);
    const c = decideShot(state, 'R', elite, sim, 4321);
    expect(c.intended).toEqual(a.intended); // the choice is the same, only execution noise differs
  });

  it('finishes an obvious open goal at every level', () => {
    for (const profile of aiProfiles) {
      const s = match(5, 'R');
      // R attacks the left goal (x < 0). Ball near the goal, an R disc lined up behind it.
      const bodies = s.bodies.map((b) => ({ ...b }));
      bodies[10] = { kind: 'ball', x: -5.2, y: 0.1 };
      bodies[5] = { kind: 'disc', x: -3.2, y: 0.1 };
      bodies[0] = { kind: 'disc', x: -6.2, y: 3.5 }; // keeper out of position
      const state = { ...s, bodies: toF32Bodies(bodies) };
      const d = decideShot(state, 'R', { ...profile, aimErrorDeg: 0, powerError: 0 }, sim, 1);
      const result = sim.simulateShot(state.bodies, { bodyIndex: d.shot.discIndex, ix: d.shot.ix, iy: d.shot.iy });
      expect(result.outcome, profile.id).toBe('goal_left');
    }
  });

  it('decides within the time budget (elite, worst case)', () => {
    const state = randomBoard(7, 'L');
    const t0 = performance.now();
    decideShot(state, 'L', profileById('elite'), sim, 1);
    expect(performance.now() - t0).toBeLessThan(1500);
  });

  it('higher profiles outscore lower ones over seeded AI-vs-AI shots', { timeout: 120_000 }, () => {
    const goalRate = (id: 'rookie' | 'elite') => {
      const profile = profileById(id);
      let goals = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const side: Side = seed % 2 ? 'L' : 'R';
        const state = randomBoard(seed * 7919, side);
        const d = decideShot(state, side, profile, sim, seed);
        const r = sim.simulateShot(state.bodies, { bodyIndex: d.shot.discIndex, ix: d.shot.ix, iy: d.shot.iy });
        if (r.outcome === (side === 'L' ? 'goal_right' : 'goal_left')) goals++;
      }
      return goals;
    };
    const rookie = goalRate('rookie');
    const elite = goalRate('elite');
    expect(elite).toBeGreaterThan(rookie);
  });

  it('plays a full bot-vs-bot match to completion with no illegal action', { timeout: 120_000 }, () => {
    let state = match(42, 'L');
    const profiles = { L: profileById('amateur'), R: profileById('pro') };
    let guard = 0;
    while (state.phase !== 'ENDED' && guard++ < 200) {
      const side = state.turn.side;
      const d = decideShot(state, side, profiles[side], sim, state.rngSeed);
      expect(validateShot(state, side, d.shot, physicsConfig).ok).toBe(true);
      const r = sim.simulateShot(state.bodies, { bodyIndex: d.shot.discIndex, ix: d.shot.ix, iy: d.shot.iy });
      state = applyShotResult(state, side, d.shot, r, rulesConfig).state;
    }
    expect(state.phase).toBe('ENDED');
    expect(state.result).not.toBeNull();
  });
});

describe('AI cost on Rapier', () => {
  it('reports decision time per profile', { timeout: 60_000 }, () => {
    const lines: string[] = [];
    for (const profile of aiProfiles) {
      const state = randomBoard(7, 'L');
      const t0 = performance.now();
      const d = decideShot(state, 'L', profile, sim, 1);
      lines.push(`${profile.id}: ${d.simulations} sims in ${Math.round(performance.now() - t0)} ms`);
    }
    console.info(lines.join('\n'));
  });
});
