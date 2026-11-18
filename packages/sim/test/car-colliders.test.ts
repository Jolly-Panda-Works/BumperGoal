import { beforeAll, expect, it } from 'vitest';
import { physicsConfig } from '@flickkick/config';
import { FlickSim, toF32Bodies } from '../src/index';

let sim: FlickSim;
beforeAll(async () => {
  sim = await FlickSim.create(physicsConfig);
});

it.each([
  ['front', 0, 0],
  ['side', 0, Math.PI / 2],
  ['rotated front', Math.PI / 4, Math.PI / 4],
  ['rotated corner', Math.PI / 4, Math.PI / 2],
] as const)('keeps a fast ball outside the car body: %s', (_name, angle, approach) => {
  const result = sim.simulateShot(
    toF32Bodies([
      { kind: 'disc', x: 0, y: 0, angle },
      { kind: 'ball', x: -2 * Math.cos(approach), y: -2 * Math.sin(approach) },
    ]),
    { bodyIndex: 1, ix: 9 * Math.cos(approach), iy: 9 * Math.sin(approach) },
    { recordFrames: true },
  );
  const { halfLength, halfWidth, borderRadius } = physicsConfig.disc;
  let closest = Infinity;
  for (let tick = 0; tick <= result.ticks; tick++) {
    const f = tick * 4;
    const dx = result.frames![f + 2]! - result.frames![f]!;
    const dy = result.frames![f + 3]! - result.frames![f + 1]!;
    const a = result.angles![tick * 2]!;
    const x = Math.abs(dx * Math.cos(a) + dy * Math.sin(a));
    const y = Math.abs(-dx * Math.sin(a) + dy * Math.cos(a));
    const distance =
      Math.hypot(Math.max(0, x - (halfLength! - borderRadius!)), Math.max(0, y - (halfWidth! - borderRadius!))) -
      borderRadius!;
    closest = Math.min(closest, distance);
    expect(distance).toBeGreaterThanOrEqual(physicsConfig.ball.radius - 0.015);
  }
  expect(closest).toBeLessThan(physicsConfig.ball.radius + 0.15);
  expect(Math.hypot(result.bodies[0]!.x, result.bodies[0]!.y)).toBeGreaterThan(0.2);
  expect(result.bodies[0]!.angle).toBe(result.angles![result.ticks * 2]);
});

it('retains the physical car heading between shots', () => {
  const first = sim.simulateShot(
    toF32Bodies([
      { kind: 'disc', x: 0, y: 0 },
      { kind: 'ball', x: -2, y: 0.4 },
    ]),
    { bodyIndex: 1, ix: 3, iy: 0 },
  );
  expect(Math.abs(first.bodies[0]!.angle!)).toBeGreaterThan(0.1);
  const next = sim.simulateShot(first.bodies, { bodyIndex: 1, ix: 0, iy: 0 }, { recordFrames: true });
  expect(next.angles![0]).toBe(first.bodies[0]!.angle);
  expect(next.bodies[0]!.angle).toBeCloseTo(first.bodies[0]!.angle!, 5);
});
