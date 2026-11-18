import { describe, expect, it } from 'vitest';
import { arenaPosition, carHeading, FIELD_WIDTH_SCALE, shotFromGround } from '../src/game/arena3dProjection';

describe('3D arena input', () => {
  it('keeps the nose of the car aligned with forward movement at every steering angle', () => {
    for (const orientation of [1, -1])
      for (const angle of [0, Math.PI / 6, Math.PI / 2, Math.PI, -Math.PI / 3]) {
        const heading = carHeading(angle, orientation);
        const direction = arenaPosition(Math.cos(angle), Math.sin(angle), orientation);
        expect(Math.sin(heading) * FIELD_WIDTH_SCALE).toBeCloseTo(direction.x, 7);
        expect(Math.cos(heading)).toBeCloseTo(direction.z, 7);
      }
  });
  for (const orientation of [1, -1]) {
    it(`keeps slingshot physics correct with camera orientation ${orientation}`, () => {
      const car = arenaPosition(-2, 1, orientation);
      const drag = arenaPosition(-4, 1, orientation);
      const shot = shotFromGround(car, drag, orientation, 1);
      expect(Math.cos(shot.angle)).toBeCloseTo(1);
      expect(Math.sin(shot.angle)).toBeCloseTo(0);
      expect(shot.power).toBeCloseTo(2 / 2.6);
      const sideDrag = arenaPosition(-2, 0, orientation);
      const sideShot = shotFromGround(car, sideDrag, orientation, 1);
      expect(Math.sin(sideShot.angle)).toBeCloseTo(1);
    });
  }
  it('preserves the dead zone and limits power on long drags', () => {
    const origin = arenaPosition(0, 0, 1);
    expect(shotFromGround(origin, arenaPosition(0.1, 0, 1), 1, 1).power).toBe(0);
    expect(shotFromGround(origin, arenaPosition(20, 10, 1), 1, 1).power).toBe(1);
  });
});
