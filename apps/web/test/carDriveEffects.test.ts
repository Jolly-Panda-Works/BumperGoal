import { expect, it } from 'vitest';
import * as THREE from 'three';
import { CarDriveEffects, fullPowerNitro, wheelPivots } from '../src/game/CarDriveEffects';

it('restores wheel axles without shifting the supplied model', () => {
  const model = new THREE.Group();
  const wheel = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.24, 0.24).translate(0.4, 0.2, 0.5));
  wheel.name = 'left_front_wheel';
  model.add(wheel);
  const before = new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3());
  const wheels = wheelPivots(model);
  expect(wheels).toHaveLength(1);
  expect(new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3()).distanceTo(before)).toBeLessThan(1e-6);
  wheels[0]!.pivot.rotation.x = 2;
  expect(wheels[0]!.pivot.position.distanceTo(before)).toBeLessThan(1e-6);
});

it('spins wheels, emits exhaust and shows nitro only while moving at full power', () => {
  const scene = new THREE.Scene(),
    root = new THREE.Group();
  scene.add(root);
  const effects = new CarDriveEffects(scene),
    rig = effects.rig(root);
  rig.wheels = [{ pivot: new THREE.Group(), radius: 0.12 }];
  effects.sample(0, rig, new THREE.Vector3(0, 0, 0.1), 16, 0, true, false, false, false);
  expect(rig.wheels[0]!.pivot.rotation.x).toBeGreaterThan(0);
  expect(effects.smokeCount).toBe(2);
  expect(rig.flame.visible).toBe(false);
  effects.sample(0, rig, new THREE.Vector3(0, 0, 0.1), 16, 100, true, fullPowerNitro(9, 0, 9), false, false);
  expect(rig.flame.visible).toBe(true);
  effects.sample(0, rig, new THREE.Vector3(), 16, 120, false, true, false, false);
  expect(rig.flame.visible).toBe(false);
  effects.update(1000, 16, false);
  expect(scene.children.filter((o) => o instanceof THREE.Sprite && o.visible)).toHaveLength(0);
  effects.dispose();
});

it('uses each team power limit and respects reduced motion', () => {
  expect(fullPowerNitro(7.65, 0, 7.65)).toBe(true);
  expect(fullPowerNitro(8.5, 0, 9)).toBe(false);
  const scene = new THREE.Scene(),
    effects = new CarDriveEffects(scene),
    rig = effects.rig(new THREE.Group());
  effects.sample(0, rig, new THREE.Vector3(0, 0, 0.1), 16, 0, true, true, true, false);
  expect(effects.smokeCount).toBe(0);
  expect(rig.flame.visible).toBe(false);
  effects.dispose();
});
