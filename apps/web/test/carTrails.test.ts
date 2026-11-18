import { expect, it } from 'vitest';
import { Scene, Vector3 } from 'three';
import { cosmetics } from '@flickkick/config';
import { CarTrails } from '../src/game/CarTrails';

it('renders every equipped catalog trail, fades it, and releases its geometry', () => {
  for (const trail of cosmetics.trails) {
    const scene = new Scene();
    const fx = new CarTrails(scene);
    fx.sample(0, new Vector3(), new Vector3(0, 0, 0.2), 16, 0, trail.id);
    fx.sample(0, new Vector3(0, 0, 0.2), new Vector3(0, 0, 0.2), 16, 16, trail.id);
    fx.update(16);
    expect(fx.activeCount).toBeGreaterThan(0);
    fx.update(700);
    expect(fx.activeCount).toBe(0);
    fx.dispose();
    expect(scene.children).toHaveLength(0);
  }
});

it('does not emit for missing equipment, slow cars or kickoff jumps', () => {
  const fx = new CarTrails(new Scene());
  for (const id of [undefined, 'missing', cosmetics.trails[0]!.id]) {
    fx.sample(0, new Vector3(), new Vector3(), 16, 0, id);
    fx.sample(0, new Vector3(20, 0, 0), new Vector3(20, 0, 0), 16, 16, id);
  }
  expect(fx.emittedCount).toBe(0);
  fx.dispose();
});

it('bounds geometry during long shots and clears effects for reduced motion', () => {
  const fx = new CarTrails(new Scene());
  for (let i = 0; i < 2000; i++)
    fx.sample(0, new Vector3(0, 0, i * 0.2), new Vector3(0, 0, 0.2), 16, i * 16, 'trail_rainbow');
  expect(fx.activeCount).toBeLessThanOrEqual(768);
  fx.update(32000, true);
  expect(fx.activeCount).toBe(0);
  fx.dispose();
});
