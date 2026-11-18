import { expect, it } from 'vitest';
import * as THREE from 'three';
import { CarSignals, nightForMatch } from '../src/game/CarSignals';

it('chooses a stable mix of day and night without depending on advanced gameplay RNG', () => {
  const choices = Array.from({ length: 1000 }, (_, i) => nightForMatch(i, `match-${i}`));
  const nights = choices.filter(Boolean).length;
  expect(nights).toBeGreaterThan(180);
  expect(nights).toBeLessThan(320);
  expect(nightForMatch(1, 'same-match')).toBe(nightForMatch(999, 'same-match'));
});

it('honks only for two cars, throttles contact noise, and flashes both cars temporarily', () => {
  const effects = new CarSignals(false),
    a = effects.attach(0, new THREE.Group()),
    b = effects.attach(1, new THREE.Group());
  expect(effects.collision([0], 1000)).toBe(false);
  expect(effects.collision([0, 6], 1000)).toBe(false);
  expect(effects.collision([0, 1], 1000)).toBe(true);
  expect(effects.collision([0, 1], 1100)).toBe(false);
  effects.sample(0, false, 1100, false);
  effects.sample(1, false, 1100, false);
  expect(a.indicators.visible).toBe(true);
  expect(b.indicators.visible).toBe(true);
  effects.sample(0, false, 1250, false);
  expect(a.indicators.visible).toBe(false);
  effects.sample(0, false, 1250, true);
  expect(a.indicators.visible).toBe(true);
  effects.sample(0, false, 4000, false);
  expect(a.indicators.visible).toBe(false);
  expect(effects.hornCount).toBe(1);
});

it('lights the path ahead only when a car moves at night and clears all lamps on kickoff', () => {
  const root = new THREE.Group(),
    effects = new CarSignals(true),
    rig = effects.attach(0, root);
  effects.sample(0, true, 1000, false);
  effects.updateCounts();
  expect(rig.headlights.visible).toBe(true);
  expect(rig.beam.visible).toBe(true);
  expect(rig.light.intensity).toBeGreaterThan(0);
  expect(rig.light.target.position.z).toBeGreaterThan(rig.light.position.z);
  root.rotation.y = Math.PI / 2;
  root.updateMatrixWorld(true);
  expect(rig.light.target.getWorldPosition(new THREE.Vector3()).x).toBeGreaterThan(4);
  effects.sample(0, false, 1100, false);
  expect(rig.light.intensity).toBe(0);
  effects.collision([0, 0], 1200);
  effects.clear();
  expect(rig.indicators.visible).toBe(false);
  expect(effects.headlightCount).toBe(0);
  const day = new CarSignals(false),
    dayRig = day.attach(0, new THREE.Group());
  day.sample(0, true, 1000, false);
  expect(dayRig.headlights.visible).toBe(false);
});
