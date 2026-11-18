import { arenaPrize, arenasConfig, progressionConfig } from '@flickkick/config';
import { levelFromXp, levelUpRewards, matchXp, type MatchState } from '@flickkick/rules';
import type { MatchStatistics } from '../game/matchStatistics';
import { localInventory } from './localInventory';
import { profileStore, queueLevelUps } from './localProfile';
import { getOnline } from './online';

// Explicit development simulation; production rewards remain server-authoritative.
export const localOnlineEnabled = import.meta.env.DEV;
export const BOT_SEARCH_MS = 10_000;

export function restoreLocalRankedProgress() {
  if (!localOnlineEnabled || getOnline().status === 'online') return;
  const ranked = localInventory.get().ranked;
  if (!ranked) return;
  const level = levelFromXp(ranked.xp, progressionConfig);
  profileStore.set((p) => ({
    ...p,
    knownXP: ranked.xp,
    knownLevel: level,
    pendingLevelUps: queueLevelUps(p.pendingLevelUps, p.knownLevel, level),
  }));
}
export function beginLocalRanked(matchId: string, arenaId: string) {
  if (!localOnlineEnabled) throw new Error('Local online simulation is disabled');
  const state = localInventory.get();
  const ranked = state.ranked ?? { xp: profileStore.get().knownXP, entries: {}, receipts: {} };
  if (ranked.entries[matchId]) {
    if (ranked.entries[matchId].arena !== arenaId) throw new Error('Arena mismatch');
    return;
  }
  const arena = arenasConfig.arenas.find((a) => a.id === arenaId);
  if (!arena || profileStore.get().knownLevel < arena.minLevel) throw new Error('Arena locked');
  if (state.coins < arena.entryFee) throw new Error('Not enough coins');
  localInventory.set({
    ...state,
    coins: state.coins - arena.entryFee,
    ranked: { ...ranked, entries: { ...ranked.entries, [matchId]: { arena: arenaId, fee: arena.entryFee } } },
  });
}
export function settleLocalRanked(state: MatchState, statistics?: MatchStatistics) {
  if (!localOnlineEnabled || !state.result) throw new Error('Invalid local settlement');
  const inventory = localInventory.get();
  const ranked = inventory.ranked;
  if (!ranked?.entries[state.matchId]) throw new Error('Entry not charged');
  const existing = ranked.receipts[state.matchId];
  if (existing) {
    restoreLocalRankedProgress();
    return existing.rewards;
  }
  const entry = ranked.entries[state.matchId]!;
  const arena = arenasConfig.arenas.find((a) => a.id === entry.arena)!;
  const won = state.result.winner === 'L';
  const before = levelFromXp(ranked.xp, progressionConfig);
  const xp = matchXp({ won, goals: state.score.L, xpMultiplier: arena.xpMultiplier }, progressionConfig);
  const totalXp = ranked.xp + xp;
  const after = levelFromXp(totalXp, progressionConfig);
  const levelReward = levelUpRewards(before, after, progressionConfig);
  const prize = won ? arenaPrize(arena) : 0;
  const rewards = {
    xp,
    coins: prize + levelReward.coins,
    gems: levelReward.gems,
    prize,
    entryFee: entry.fee,
    levelBefore: before,
    levelAfter: after,
  };
  const profile = profileStore.get();
  const record = {
    id: state.matchId,
    endedAt: Date.now(),
    mode: 'online' as const,
    playerName: state.players[0].displayName,
    playerAvatarId: profile.avatarId,
    opponentName: state.players[1].displayName,
    opponentAvatarId: 'bot',
    opponentIsBot: true,
    teamId: state.players[0].teamId,
    opponentTeamId: state.players[1].teamId,
    playerSide: 'L' as const,
    aiProfile: null,
    statistics,
    scoreFor: state.score.L,
    scoreAgainst: state.score.R,
    won,
    reason: state.result.reason,
  };
  // Wallet, XP and receipt share one persisted object: retries cannot double-pay.
  localInventory.set({
    ...inventory,
    coins: inventory.coins + rewards.coins,
    gems: inventory.gems + rewards.gems,
    ranked: {
      ...ranked,
      xp: totalXp,
      receipts: { ...ranked.receipts, [state.matchId]: { record, arena: arena.id, rewards } },
    },
  });
  restoreLocalRankedProgress();
  return rewards;
}
export function localRankedHistory() {
  return Object.values(localInventory.get().ranked?.receipts ?? {})
    .sort((a, b) => b.record.endedAt - a.record.endedAt)
    .slice(0, 50);
}

/** Development-only XP for finished AI, two-player and tutorial matches.
 * Share the durable XP ledger with local ranked play; retrying a result cannot pay twice.
 */
export function settleLocalPractice(state: MatchState) {
  if (!localOnlineEnabled || getOnline().status === 'online' || !state.result) return null;
  const inventory = localInventory.get();
  const ranked = inventory.ranked ?? { xp: profileStore.get().knownXP, entries: {}, receipts: {} };
  const existing = ranked.practiceRewards?.[state.matchId];
  if (existing) {
    restoreLocalRankedProgress();
    return existing;
  }
  const xp = matchXp({ won: state.result.winner === 'L', goals: state.score.L, xpMultiplier: 1 }, progressionConfig);
  const before = levelFromXp(ranked.xp, progressionConfig);
  const totalXp = ranked.xp + xp;
  const after = levelFromXp(totalXp, progressionConfig);
  const levelReward = levelUpRewards(before, after, progressionConfig);
  const rewards = {
    xp,
    coins: levelReward.coins,
    gems: levelReward.gems,
    prize: 0,
    entryFee: 0,
    levelBefore: before,
    levelAfter: after,
  };
  localInventory.set({
    ...inventory,
    coins: inventory.coins + rewards.coins,
    gems: inventory.gems + rewards.gems,
    ranked: { ...ranked, xp: totalXp, practiceRewards: { ...ranked.practiceRewards, [state.matchId]: rewards } },
  });
  restoreLocalRankedProgress();
  return rewards;
}
