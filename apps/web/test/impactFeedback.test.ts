import { describe, expect, it } from 'vitest';
import { Group, PerspectiveCamera, Scene, Vector3 } from 'three';
import { ImpactEffects } from '../src/game/ImpactEffects';
import { collisionContact } from '../src/game/collisionContact';

const high = { quality: 'high' as const, reducedMotion: false };

describe('collision feedback', () => {
  it('uses the contact surface and distinguishes ball, car and wall hits', () => {
    const impact = { index: 0, x: 0, y: 0, strength: 0.2, nearWall: false };
    const ball = collisionContact(impact, [
      { kind: 'disc', x: 0, y: 0 },
      { kind: 'ball', x: 0.63, y: 0 },
    ]);
    expect(ball.kind).toBe('ball');
    expect(ball.x).toBeCloseTo(0.71);
    expect(ball.bodies).toEqual([0, 1]);
    expect(
      collisionContact(impact, [
        { kind: 'disc', x: 0, y: 0 },
        { kind: 'disc', x: 0.84, y: 0 },
      ]).kind,
    ).toBe('car');
    const wall = collisionContact({ ...impact, y: 4.2, nearWall: true }, [{ kind: 'disc', x: 0, y: 4.2 }]);
    expect(wall.kind).toBe('wall');
    expect(wall.y).toBe(4.5);
  });

  it('deduplicates a contact and expires its effects', () => {
    const scene = new Scene(),
      fx = new ImpactEffects(scene),
      camera = new PerspectiveCamera();
    expect(fx.emit(new Vector3(), 'car', 1, 0, high, [0, 1])).toBe(true);
    expect(fx.emit(new Vector3(0.1, 0, 0), 'car', 1, 30, high, [0, 1])).toBe(false);
    expect(fx.activeCount).toBe(1);
    fx.update(500, camera, false);
    expect(fx.activeCount).toBe(0);
    expect(fx.cameraOffset(500, camera).length()).toBe(0);
    fx.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('bounds particle pools on both graphics settings', () => {
    for (const [quality, max] of [
      ['high', 10],
      ['low', 4],
    ] as const) {
      const fx = new ImpactEffects(new Scene());
      for (let i = 0; i < 30; i++)
        fx.emit(new Vector3(i * 2, 0, 0), 'wall', 1, i * 10, { quality, reducedMotion: false }, [i]);
      expect(fx.activeCount).toBe(max);
      fx.dispose();
    }
  });

  it('keeps chassis recoil separate from the canonical car transform and resets it', () => {
    const fx = new ImpactEffects(new Scene()),
      parent = new Group(),
      chassis = new Group();
    parent.position.set(3, 0, 4);
    parent.rotation.y = 1.1;
    parent.add(chassis);
    fx.emit(new Vector3(), 'car', 1, 0, high, [4]);
    fx.applyChassis(4, chassis, 40, false);
    expect(chassis.position.y).toBeGreaterThan(0);
    expect(chassis.scale.y).toBeLessThan(1);
    expect(parent.position.toArray()).toEqual([3, 0, 4]);
    expect(parent.rotation.y).toBe(1.1);
    fx.clear();
    fx.applyChassis(4, chassis, 50, false);
    expect(chassis.position.toArray()).toEqual([0, 0, 0]);
    expect(chassis.scale.toArray()).toEqual([1, 1, 1]);
    fx.dispose();
  });

  it('respects reduced motion and scales camera impulse with impact strength', () => {
    const weak = new ImpactEffects(new Scene()),
      strong = new ImpactEffects(new Scene()),
      camera = new PerspectiveCamera();
    expect(weak.emit(new Vector3(), 'ball', 1, 0, { ...high, reducedMotion: true }, [0])).toBe(false);
    expect(weak.activeCount).toBe(0);
    weak.emit(new Vector3(), 'car', 0.4, 0, high, [0]);
    strong.emit(new Vector3(), 'car', 1, 0, high, [0]);
    expect(strong.cameraOffset(40, camera).length()).toBeGreaterThan(weak.cameraOffset(40, camera).length());
    strong.update(50, camera, true);
    expect(strong.activeCount).toBe(0);
    weak.dispose();
    strong.dispose();
  });
});
