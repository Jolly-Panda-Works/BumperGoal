import { beforeEach, describe, expect, it } from 'vitest';
import {
  claimLocalDaily,
  dailyClaimedCount,
  claimLocalPack,
  localInventory,
  mirrorServerInventory,
  ownsLocal,
  purchaseLocal,
} from '../src/services/localInventory';
import { cosmetics } from '@flickkick/config';
import type { ServerProfile } from '../src/services/online';
describe('device-only shop inventory', () => {
  beforeEach(() =>
    localInventory.set({ coins: 500, gems: 10, owned: [], packs: [], lastDaily: undefined, dailyIndex: 0 }),
  );
  it('deducts currency once, persists ownership and rejects unaffordable purchases', () => {
    expect(purchaseLocal('balls', 'ball_neon')).toBe(true);
    expect(localInventory.get().coins).toBe(200);
    expect(ownsLocal('balls', 'ball_neon')).toBe(true);
    expect(purchaseLocal('balls', 'ball_neon')).toBe(true);
    expect(localInventory.get().coins).toBe(200);
    expect(purchaseLocal('balls', 'ball_gold')).toBe(false);
    expect(localInventory.get().gems).toBe(10);
    expect(purchaseLocal('balls', 'unknown')).toBe(false);
  });
  it('claims each daily reward only once per local date', () => {
    expect(claimLocalDaily(new Date(2026, 9, 31))).toBe(true);
    const coins = localInventory.get().coins;
    expect(claimLocalDaily(new Date(2026, 9, 31))).toBe(false);
    expect(localInventory.get().coins).toBe(coins);
    expect(claimLocalDaily(new Date(2026, 10, 1))).toBe(true);
    expect(localInventory.get().dailyIndex).toBe(2);
  });
  it('keeps completed reward tiles through day seven and starts the next cycle tomorrow', () => {
    const today = new Date(2026, 10, 1);
    localInventory.set((p) => ({ ...p, dailyIndex: 6, lastDaily: new Date(2026, 9, 31).toDateString() }));
    expect(dailyClaimedCount(today)).toBe(6);
    expect(claimLocalDaily(today)).toBe(true);
    expect(localInventory.get().gems).toBe(15);
    expect(dailyClaimedCount(today)).toBe(7);
    expect(dailyClaimedCount(new Date(2026, 10, 2))).toBe(0);
    expect(claimLocalDaily(today)).toBe(false);
    expect(dailyClaimedCount(today)).toBe(7);
  });
  it('grants the selected pack currency and rejects unknown pack IDs', () => {
    expect(claimLocalPack('pack_coins_1')).toBe(true);
    expect(localInventory.get().coins).toBe(1500);
    expect(claimLocalPack('pack_gems_1')).toBe(true);
    expect(localInventory.get().gems).toBe(60);
    expect(localInventory.get().coins).toBe(1500);
    expect(claimLocalPack('unknown')).toBe(false);
  });
});

it('mirrors the server wallet, ownership and daily cycle', () => {
  const team = cosmetics.teams.find((item) => item.price !== null)!.id;
  localInventory.set({ coins: 9999, gems: 99, owned: ['offline_item'], packs: [], dailyIndex: 1 });
  mirrorServerInventory({
    wallet: { coins: 1200, gems: 30 },
    ownedTeams: [team],
    daily: { index: 3, claimedToday: true },
  } as ServerProfile);
  const state = localInventory.get();
  expect([state.coins, state.gems, state.dailyIndex]).toEqual([1200, 30, 3]);
  expect(state.owned).toEqual(['offline_item', team]);
  expect(state.lastDaily).toBe(new Date().toDateString());
  mirrorServerInventory({ wallet: {}, daily: { index: 3, claimedToday: false } } as ServerProfile);
  expect([localInventory.get().coins, localInventory.get().lastDaily]).toEqual([0, undefined]);
});
