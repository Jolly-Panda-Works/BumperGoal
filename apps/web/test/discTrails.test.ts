import { expect, it } from 'vitest';
import { cosmetics } from '@flickkick/config';
import { activeTrailId, DiscTrailBuffer } from '../src/game/discTrails';
import { defaultProfile } from '../src/services/localProfile';
import { localInventory, ownsLocal, purchaseLocal } from '../src/services/localInventory';
it('ships ten paid-only trails and equips nothing by default', () => {
  expect(cosmetics.trails).toHaveLength(10);
  expect(defaultProfile().trailId).toBe('');
  localInventory.set({ coins: 600, gems: 0, owned: [], packs: [] });
  for (const trail of cosmetics.trails) {
    expect(Object.values(trail.price).some((v) => v > 0)).toBe(true);
    expect(ownsLocal('trails', trail.id)).toBe(false);
  }
  const id = cosmetics.trails[0]!.id;
  expect(purchaseLocal('trails', id)).toBe(true);
  expect(ownsLocal('trails', id)).toBe(true);
  expect(localInventory.get().coins).toBe(100);
  purchaseLocal('trails', id);
  expect(localInventory.get().coins).toBe(100);
});
it('scales length by actual motion speed and tapers the tail', () => {
  function motion(step: number) {
    const buffer = new DiscTrailBuffer();
    let result = buffer.sample(0, 0, 0);
    for (let i = 1; i <= 20; i++) result = buffer.sample(i * step, 0, i * 16);
    return result;
  }
  const slow = motion(0.8),
    fast = motion(8);
  const length = (s: ReturnType<DiscTrailBuffer['sample']>) =>
    s.reduce((sum, p) => sum + Math.hypot(p.x2 - p.x1, p.y2 - p.y1), 0);
  expect(length(fast)).toBeGreaterThan(length(slow) * 2.8);
  expect(length(fast)).toBeLessThanOrEqual(220);
  expect(fast[0]!.width).toBeGreaterThan(fast.at(-1)!.width);
});
it('draws nothing at rest, after resets, or across teleport corrections', () => {
  const b = new DiscTrailBuffer();
  expect(b.sample(0, 0, 0)).toEqual([]);
  expect(b.sample(10, 0, 16).length).toBeGreaterThan(0);
  expect(b.sample(10, 0, 32)).toEqual([]);
  expect(b.sample(500, 0, 48)).toEqual([]);
  b.clear();
  expect(b.sample(510, 0, 64)).toEqual([]);
});

it('uses late online trail sync and respects an explicit unequip', () => {
  const initial = {};
  const live: Partial<Record<'L' | 'R', string>> = {};
  expect(activeTrailId('L', live, initial)).toBeUndefined();
  live.L = 'trail_neon_surge';
  expect(activeTrailId('L', live, initial)).toBe('trail_neon_surge');
  live.L = '';
  expect(activeTrailId('L', live, { L: 'trail_neon_surge' })).toBe('');
  expect(activeTrailId('R', undefined, { L: 'trail_neon_surge' })).toBeUndefined();
});
it('keeps the moving trail readable at phone scale', () => {
  const buffer = new DiscTrailBuffer();
  buffer.sample(0, 0, 0);
  const first = buffer.sample(8, 0, 16)[0]!;
  expect(first.x1).toBe(8);
  expect(first.y1).toBe(0);
  expect(first.width * 0.3).toBeGreaterThan(7);
  expect(first.alpha).toBeGreaterThan(0.85);
});

it('anchors the trail at the moving disc center and continues through previous positions', () => {
  const buffer = new DiscTrailBuffer();
  buffer.sample(0, 0, 0);
  buffer.sample(8, 2, 16);
  const segments = buffer.sample(16, 5, 32);
  expect(segments[0]).toMatchObject({ x1: 16, y1: 5, x2: 8, y2: 2 });
  expect(segments[1]).toMatchObject({ x1: 8, y1: 2, x2: 0, y2: 0 });
});

it('reuses render output without changing trail geometry through long runs and resets', () => {
  const snapshots = new DiscTrailBuffer();
  const rendering = new DiscTrailBuffer();
  const output: ReturnType<DiscTrailBuffer['sample']> = [];
  for (let i = 0; i < 600; i++) {
    const x = i < 300 ? i * 3 : (i - 300) * 2;
    const y = Math.sin(i / 12) * 30;
    expect(rendering.sample(x, y, i * 16, output)).toBe(output);
    expect(output).toEqual(snapshots.sample(x, y, i * 16));
  }
  const sample = snapshots.sample(602, 0, 9600);
  const saved = structuredClone(sample);
  snapshots.sample(605, 0, 9616);
  expect(sample).toEqual(saved);
  rendering.clear();
  expect(rendering.sample(0, 0, 10000, output)).toEqual([]);
});
