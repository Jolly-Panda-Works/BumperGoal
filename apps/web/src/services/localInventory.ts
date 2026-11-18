import { useSyncExternalStore } from 'react';
import { cosmetics, economyConfig, legacyTeamId } from '@flickkick/config';
import { Store } from './storage';
import { getOnline, type ServerProfile } from './online';
import type { LocalMatchRecord } from './localProfile';
import type { OnlineRewards } from '../game/OnlineMatchController';
export type CosmeticKind = 'teams' | 'balls' | 'avatars' | 'formations' | 'trails';
export interface LocalRankedReceipt {
  record: LocalMatchRecord;
  arena: string;
  rewards: OnlineRewards;
}
interface LocalInventory {
  ranked?: {
    xp: number;
    practiceRewards?: Record<string, OnlineRewards>;
    entries: Record<string, { arena: string; fee: number }>;
    receipts: Record<string, LocalRankedReceipt>;
  };
  coins: number;
  gems: number;
  owned: string[];
  packs: string[];
  lastDaily?: string;
  dailyIndex?: number;
}
/** Device-only practice inventory. Never grants online currency or server ownership. */
export const localInventory = new Store<LocalInventory>(
  'flickkick.inventory.v1',
  {
    coins: economyConfig.startingBalance.coins,
    gems: economyConfig.startingBalance.gems,
    owned: [],
    packs: [],
  },
  (raw) => ({
    ranked: raw.ranked,
    coins: Math.max(0, Number(raw.coins) || 0),
    gems: Math.max(0, Number(raw.gems) || 0),
    owned: Array.isArray(raw.owned)
      ? [...new Set(raw.owned.filter((id) => typeof id === 'string').map(legacyTeamId))]
      : [],
    lastDaily: typeof raw.lastDaily === 'string' ? raw.lastDaily : undefined,
    dailyIndex: Number.isInteger(raw.dailyIndex) ? raw.dailyIndex : 0,
    packs: Array.isArray(raw.packs) ? raw.packs.filter((id) => typeof id === 'string') : [],
  }),
);
export const useLocalInventory = () => useSyncExternalStore(localInventory.subscribe, localInventory.get);
const serverOwned = (p: ServerProfile, kind: CosmeticKind) =>
  ({
    teams: p.ownedTeams,
    balls: p.ownedBalls,
    avatars: p.ownedAvatars,
    formations: p.ownedFormations,
    trails: p.ownedTrails,
  })[kind] ?? [];

/** Online, the server wallet, ownership and daily cycle win; offline play keeps the last synced copy. */
export function mirrorServerInventory(p: ServerProfile): void {
  const kinds: CosmeticKind[] = ['teams', 'balls', 'avatars', 'formations', 'trails'];
  const today = new Date().toDateString();
  localInventory.set((state) => ({
    ...state,
    coins: p.wallet.coins ?? 0,
    gems: p.wallet.gems ?? 0,
    owned: [...new Set([...state.owned, ...kinds.flatMap((kind) => serverOwned(p, kind))])],
    ...(p.daily && {
      dailyIndex: p.daily.index,
      lastDaily: p.daily.claimedToday ? today : state.lastDaily === today ? undefined : state.lastDaily,
    }),
  }));
}

export const ownsLocal = (kind: CosmeticKind, id: string) => {
  const online = getOnline();
  return cosmetics[kind].some(
    (i) =>
      i.id === id &&
      (i.price === null ||
        (online.status === 'online' && online.profile
          ? serverOwned(online.profile, kind).includes(id)
          : localInventory.get().owned.includes(id))),
  );
};
export function purchaseLocal(kind: CosmeticKind, id: string): boolean {
  const item = cosmetics[kind].find((i) => i.id === id);
  if (!item) return false;
  const state = localInventory.get();
  if (ownsLocal(kind, id)) return true;
  const price = item.price;
  if (!price) return true;
  if (state.coins < (price.coins ?? 0) || state.gems < (price.gems ?? 0)) return false;
  localInventory.set({
    ...state,
    coins: state.coins - (price.coins ?? 0),
    gems: state.gems - (price.gems ?? 0),
    owned: [...state.owned, id],
  });
  return true;
}
export function claimLocalPack(id: string): boolean {
  const pack = cosmetics.currencyPacks.find((p) => p.id === id);
  if (!pack) return false;
  const state = localInventory.get();
  if (pack.oneTime && state.packs.includes(id)) return false;
  localInventory.set({
    ...state,
    coins: state.coins + (pack.grant.coins ?? 0),
    gems: state.gems + (pack.grant.gems ?? 0),
    packs: [...new Set([...state.packs, id])],
  });
  return true;
}

export function claimLocalDaily(now = new Date()): boolean {
  const state = localInventory.get();
  const today = now.toDateString();
  if (state.lastDaily === today) return false;
  const index = (state.dailyIndex ?? 0) % economyConfig.dailyRewards.length;
  const reward = economyConfig.dailyRewards[index]!;
  localInventory.set({
    ...state,
    coins: state.coins + (reward.coins ?? 0),
    gems: state.gems + (reward.gems ?? 0),
    lastDaily: today,
    dailyIndex: index + 1,
  });
  return true;
}

/** Completed tiles in the visible reward cycle; keep day seven visible until tomorrow. */
export function dailyClaimedCount(now = new Date()): number {
  const { dailyIndex = 0, lastDaily } = localInventory.get();
  const length = economyConfig.dailyRewards.length;
  const remainder = dailyIndex % length;
  return dailyIndex > 0 && remainder === 0 && lastDaily === now.toDateString() ? length : remainder;
}
