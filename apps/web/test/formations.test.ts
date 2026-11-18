import { expect, it } from 'vitest';
import { cosmetics, physicsConfig, rulesConfig } from '@flickkick/config';
import { kickoffBodies } from '@flickkick/rules';
import { localInventory, ownsLocal, purchaseLocal } from '../src/services/localInventory';
it('offers three free and seventeen distinct purchasable legal formations', () => {
  expect(cosmetics.formations.filter((f) => f.price === null)).toHaveLength(3);
  expect(cosmetics.formations.filter((f) => f.price !== null)).toHaveLength(17);
  expect(new Set(cosmetics.formations.map((f) => JSON.stringify(f.positions))).size).toBe(20);
  for (const f of cosmetics.formations) {
    expect(f.positions).toHaveLength(rulesConfig.discsPerTeam);
    for (const [i, [x, y]] of f.positions.entries()) {
      expect(x).toBeLessThan(-physicsConfig.disc.halfLength!);
      expect(Math.abs(x)).toBeLessThan(physicsConfig.arena.halfWidth - physicsConfig.disc.halfLength!);
      expect(Math.abs(y)).toBeLessThan(physicsConfig.arena.halfHeight - physicsConfig.disc.halfWidth!);
      for (const [a, b] of f.positions.slice(i + 1))
        expect(
          Math.abs(x - a) > physicsConfig.disc.halfLength! * 2 || Math.abs(y - b) > physicsConfig.disc.halfWidth! * 2,
        ).toBe(true);
    }
  }
});
it('keeps opposing layouts independent and charges a formation only once', () => {
  const f = cosmetics.formations[3]!;
  const bodies = kickoffBodies({ ...rulesConfig, formation: f.positions, opponentFormation: rulesConfig.formation });
  expect(bodies[1]!.x).toBeCloseTo(f.positions[1]![0]);
  expect(bodies[6]!.x).toBeCloseTo(-rulesConfig.formation[1]![0]);
  localInventory.set({ coins: 500, gems: 10, owned: [], packs: [] });
  expect(ownsLocal('formations', cosmetics.formations[0]!.id)).toBe(true);
  expect(purchaseLocal('formations', f.id)).toBe(true);
  expect(ownsLocal('formations', f.id)).toBe(true);
  expect(localInventory.get().coins).toBe(100);
  expect(purchaseLocal('formations', f.id)).toBe(true);
  expect(localInventory.get().coins).toBe(100);
});
