import { describe, expect, it } from 'vitest';
import { arenaPosition, shotFromGround } from '../src/game/arena3dProjection';

describe('3D arena input', () => {
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
