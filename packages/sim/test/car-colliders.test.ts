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

it('starts the selected car and its collider facing the shot arrow', () => {
  const result = sim.simulateShot(
    toF32Bodies([{ kind: 'disc', x: 0, y: 0, angle: 0 }]),
    { bodyIndex: 0, ix: 2, iy: 2 },
    { recordFrames: true },
  );
  expect(result.angles![0]).toBeCloseTo(Math.PI / 4, 6);
  expect(result.bodies[0]!.angle).toBeCloseTo(Math.PI / 4, 6);
});

it('heavier cars move less under the same impulse and retain their mass', () => {
  const shoot = (massScale: number) =>
    sim.simulateShot(toF32Bodies([{ kind: 'disc', x: 0, y: 0, massScale }]), { bodyIndex: 0, ix: 2, iy: 0 });
  const light = shoot(1),
    heavy = shoot(1.24);
  expect(heavy.bodies[0]!.x).toBeLessThan(light.bodies[0]!.x * 0.9);
  expect(heavy.bodies[0]!.massScale).toBe(Math.fround(1.24));
});

it.each([0, Math.PI / 6, Math.PI / 2, Math.PI, -Math.PI / 3])('drives forward along the chosen heading %s', (angle) => {
  const result = sim.simulateShot(
    toF32Bodies([{ kind: 'disc', x: 0, y: 0 }]),
    { bodyIndex: 0, ix: Math.fround(2 * Math.cos(angle)), iy: Math.fround(2 * Math.sin(angle)) },
    { maxSteps: 20 },
  );
  const car = result.bodies[0]!;
  expect(car.x * Math.cos(angle) + car.y * Math.sin(angle)).toBeGreaterThan(0);
  expect(Math.abs(car.x * Math.sin(angle) - car.y * Math.cos(angle))).toBeLessThan(0.00001);
});

it('tire grip reduces sideways sliding after a collision', async () => {
  const noGrip = await FlickSim.create({ ...physicsConfig, disc: { ...physicsConfig.disc, lateralGrip: 0 } });
  const bodies = toF32Bodies([
    { kind: 'disc', x: -2, y: 0 },
    { kind: 'disc', x: 0, y: 0, angle: Math.PI / 2 },
  ]);
  const impulse = { bodyIndex: 0, ix: 3, iy: 0 };
  const withGrip = sim.simulateShot(bodies, impulse);
  const withoutGrip = noGrip.simulateShot(bodies, impulse);
  expect(withoutGrip.bodies[1]!.x).toBeGreaterThan(0.1);
  expect(withGrip.bodies[1]!.x).toBeLessThan(withoutGrip.bodies[1]!.x * 0.8);
});
