import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { physicsConfig } from '@flickkick/config';
import { FlickSim, RAPIER_VERSION, hashBodies, toF32Bodies, type BodyState, type Impulse } from '../src/index';

// Shared vectors: the Go/wazero test (server/nakama/sim) replays the same
// scenarios and must produce exactly these hashes.
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const scenarios = JSON.parse(readFileSync(here('./scenarios.json'), 'utf8')) as {
  repetitions: number;
  scenarios: { name: string; bodies: [string, number, number][]; shots: [number, number, number][] }[];
};
const VECTORS = here('./vectors.json');

interface ShotVector {
  outcome: string;
  ticks: number;
  hash: string;
}

function scenarioBodies(raw: [string, number, number][]): BodyState[] {
  return toF32Bodies(raw.map(([k, x, y]) => ({ kind: k === 'b' ? 'ball' : 'disc', x, y })));
}

function impulseOf([bodyIndex, ix, iy]: [number, number, number]): Impulse {
  return { bodyIndex, ix: Math.fround(ix), iy: Math.fround(iy) };
}

let sim: FlickSim;
beforeAll(async () => {
  sim = await FlickSim.create(physicsConfig);
});

function runScenario(s: (typeof scenarios.scenarios)[number]): ShotVector[] {
  let bodies = scenarioBodies(s.bodies);
  return s.shots.map((shot) => {
    const r = sim.simulateShot(bodies, impulseOf(shot));
    bodies = r.bodies;
    return { outcome: r.outcome, ticks: r.ticks, hash: r.hash };
  });
}

describe('cross-runtime vectors', () => {
  it('match vectors.json (or regenerate with UPDATE_VECTORS=1)', () => {
    const actual = Object.fromEntries(scenarios.scenarios.map((s) => [s.name, runScenario(s)]));
    if (process.env.UPDATE_VECTORS === '1' || !existsSync(VECTORS)) {
      writeFileSync(
        VECTORS,
        `${JSON.stringify({ rapier: RAPIER_VERSION, physics: physicsConfig, results: actual }, null, 2)}\n`,
      );
    }
    const expected = JSON.parse(readFileSync(VECTORS, 'utf8')) as {
      physics: unknown;
      results: Record<string, ShotVector[]>;
    };
    expect(expected.physics, 'physics.json changed: regenerate vectors').toEqual(physicsConfig);
    expect(actual).toEqual(expected.results);
  });

  it.each(scenarios.scenarios.map((s) => [s.name, s] as const))('%s is identical over repetitions', (_n, s) => {
    const first = JSON.stringify(runScenario(s));
    for (let i = 1; i < scenarios.repetitions; i++) expect(JSON.stringify(runScenario(s))).toBe(first);
  });
});

describe('wasm identity', () => {
  it('the compat loader embeds the exact @dimforge/rapier2d-deterministic wasm the server runs', () => {
    const require = (p: string) => fileURLToPath(import.meta.resolve(p));
    const compat = readFileSync(require('@dimforge/rapier2d-deterministic-compat'), 'utf8');
    const start = compat.indexOf('AGFzbQ');
    const quote = compat[start - 1]!;
    const embedded = Buffer.from(compat.slice(start, compat.indexOf(quote, start)), 'base64');
    const server = readFileSync(here('../../../server/nakama/sim/rapier_wasm2d_bg.wasm'));
    const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
    expect(sha(embedded)).toBe(sha(server));
    expect(sha(server)).toBe('0570d5c822275fbadbbfe4bda0c589b039c2f41259676dc53f6679085601155d');
  });
});

describe('simulation contract', () => {
  const twoDiscs = toF32Bodies([
    { kind: 'disc', x: -3, y: 0 },
    { kind: 'disc', x: 0, y: 0.1 },
  ]);

  it('frame recording does not change the result and covers every tick', () => {
    const plain = sim.simulateShot(twoDiscs, { bodyIndex: 0, ix: 6, iy: 0 });
    const rec = sim.simulateShot(twoDiscs, { bodyIndex: 0, ix: 6, iy: 0 }, { recordFrames: true });
    expect(rec.hash).toBe(plain.hash);
    expect(rec.frames!.length).toBe((rec.ticks + 1) * 2 * 2);
    expect(rec.frames![0]).toBe(twoDiscs[0]!.x);
    expect(rec.frames![rec.frames!.length - 4]).toBe(rec.bodies[0]!.x);
  });

  it('settles within the step budget', () => {
    const r = sim.simulateShot(twoDiscs, { bodyIndex: 0, ix: 9, iy: 3 });
    expect(r.outcome).toBe('settled');
    expect(r.ticks).toBeLessThan(physicsConfig.maxStepsPerShot);
  });

  it('times out at maxSteps and still returns a usable at-rest state', () => {
    const r = sim.simulateShot(twoDiscs, { bodyIndex: 0, ix: 9, iy: 0 }, { maxSteps: 10 });
    expect(r.outcome).toBe('timeout');
    expect(r.ticks).toBe(10);
    expect(r.bodies.every((b) => Number.isFinite(b.x))).toBe(true);
  });

  it('detects goals on both sides', () => {
    const right = sim.simulateShot(
      toF32Bodies([
        { kind: 'disc', x: 3, y: 0 },
        { kind: 'ball', x: 5, y: 0.2 },
      ]),
      { bodyIndex: 0, ix: 6, iy: 0.5 },
    );
    expect(right.outcome).toBe('goal_right');
    const left = sim.simulateShot(
      toF32Bodies([
        { kind: 'disc', x: -3, y: 0 },
        { kind: 'ball', x: -5, y: -0.2 },
      ]),
      { bodyIndex: 0, ix: -6, iy: -0.5 },
    );
    expect(left.outcome).toBe('goal_left');
  });

  it('keeps the new space in play and scores only beyond the relocated goal line', () => {
    for (const side of [-1, 1]) {
      const shot = (x: number) =>
        sim.simulateShot(
          toF32Bodies([
            { kind: 'disc', x: 0, y: 3 },
            { kind: 'ball', x: x * side, y: 0 },
          ]),
          { bodyIndex: 0, ix: 0.01, iy: 0 },
        );
      expect(shot(8.1).outcome).toBe('settled');
      expect(shot(physicsConfig.arena.halfWidth + 0.1).outcome).toBe(side === 1 ? 'goal_right' : 'goal_left');
    }
  });

  it('walls contain the bodies', () => {
    const r = sim.simulateShot(toF32Bodies([{ kind: 'disc', x: 0, y: 0 }]), { bodyIndex: 0, ix: 9, iy: 9 });
    expect(r.outcome).toBe('settled');
    expect(Math.abs(r.bodies[0]!.y)).toBeLessThan(physicsConfig.arena.halfHeight);
    expect(Math.abs(r.bodies[0]!.x)).toBeLessThan(physicsConfig.arena.halfWidth + physicsConfig.arena.goalDepth);
  });

  it('slow shots stop at the resting threshold without drifting', () => {
    const r = sim.simulateShot(twoDiscs, { bodyIndex: 0, ix: 0.02, iy: 0 });
    expect(r.outcome).toBe('settled');
    const again = sim.simulateShot(r.bodies, { bodyIndex: 1, ix: 0.001, iy: 0 });
    expect(again.bodies[0]).toEqual(r.bodies[0]);
  });

  it('serialized state round-trips through JSON exactly', () => {
    const r = sim.simulateShot(twoDiscs, { bodyIndex: 0, ix: 7.3, iy: 1.1 });
    const restored = JSON.parse(JSON.stringify(r.bodies)) as BodyState[];
    expect(hashBodies(restored)).toBe(r.hash);
    const a = sim.simulateShot(r.bodies, { bodyIndex: 1, ix: -4, iy: 2 });
    const b = sim.simulateShot(restored, { bodyIndex: 1, ix: -4, iy: 2 });
    expect(b.hash).toBe(a.hash);
  });

  it('flags non-finite input as invalid without touching the engine', () => {
    const r = sim.simulateShot(
      [
        { kind: 'disc', x: Number.NaN, y: 0 },
        { kind: 'disc', x: 1, y: 0 },
      ],
      { bodyIndex: 1, ix: 1, iy: 0 },
    );
    expect(r.outcome).toBe('invalid');
  });

  it('rejects an out-of-range body index', () => {
    expect(() => sim.simulateShot(twoDiscs, { bodyIndex: 5, ix: 1, iy: 0 })).toThrow();
  });

  it('hashBodies is order and kind sensitive', () => {
    const a = hashBodies(twoDiscs);
    expect(hashBodies([...twoDiscs].reverse())).not.toBe(a);
    expect(hashBodies([{ ...twoDiscs[0]!, kind: 'ball' }, twoDiscs[1]!])).not.toBe(a);
  });
});

it.each(scenarios.scenarios.map((s) => [s.name, s] as const))(
  '%s preserves all shot results with and without frame recording',
  (_name, scenario) => {
    let bodies = scenarioBodies(scenario.bodies);
    for (const shot of scenario.shots) {
      const plain = sim.simulateShot(bodies, impulseOf(shot));
      const recorded = sim.simulateShot(bodies, impulseOf(shot), { recordFrames: true });
      expect({ ...plain, frames: null }).toEqual({ ...recorded, frames: null });
      bodies = plain.bodies;
    }
  },
);
