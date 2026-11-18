import { beforeEach, expect, it } from 'vitest';
import { arenaPrize, arenasConfig, progressionConfig, rulesConfig } from '@flickkick/config';
import { createMatch, levelFromXp, levelUpRewards, matchXp, type MatchState } from '@flickkick/rules';
import {
  beginLocalRanked,
  BOT_SEARCH_MS,
  localOnlineEnabled,
  restoreLocalRankedProgress,
  settleLocalRanked,
  settleLocalPractice,
} from '../src/services/localRanked';
import { localInventory } from '../src/services/localInventory';
import { profileStore } from '../src/services/localProfile';
const arena = arenasConfig.arenas[0]!;
const ended = (id: string, won = true): MatchState => ({
  ...createMatch({
    matchId: id,
    mode: 'local_ai',
    rngSeed: 1,
    rules: rulesConfig,
    players: [
      { id: 'me', displayName: 'Tester', level: 1, teamId: 'team_volt', isBot: false },
      { id: 'bot', displayName: 'FlickBot', level: 1, teamId: 'team_coral', isBot: true },
    ],
  }),
  phase: 'ENDED',
  score: { L: won ? 2 : 1, R: won ? 0 : 2 },
  result: { winner: won ? 'L' : 'R', reason: 'goals' },
});
beforeEach(() => {
  localInventory.set({ coins: 1000, gems: 0, owned: [], packs: [], ranked: undefined });
  profileStore.set({ knownXP: 0, knownLevel: 1, pendingLevelUps: [] });
});
it('searches for ten seconds in development', () => {
  expect(localOnlineEnabled).toBe(true);
  expect(BOT_SEARCH_MS).toBe(10000);
});
it('charges once and settles using the online XP/prize/level formulas once', () => {
  beginLocalRanked('ranked-1', arena.id);
  beginLocalRanked('ranked-1', arena.id);
  expect(localInventory.get().coins).toBe(1000 - arena.entryFee);
  const reward = settleLocalRanked(ended('ranked-1'));
  const xp = matchXp({ won: true, goals: 2, xpMultiplier: arena.xpMultiplier }, progressionConfig);
  const after = levelFromXp(xp, progressionConfig),
    levelReward = levelUpRewards(1, after, progressionConfig);
  expect(reward).toEqual({
    xp,
    coins: arenaPrize(arena) + levelReward.coins,
    gems: levelReward.gems,
    prize: arenaPrize(arena),
    entryFee: arena.entryFee,
    levelBefore: 1,
    levelAfter: after,
  });
  const coins = localInventory.get().coins;
  expect(settleLocalRanked(ended('ranked-1'))).toEqual(reward);
  expect(localInventory.get().coins).toBe(coins);
  expect(profileStore.get().knownXP).toBe(xp);
});
it('gives loss XP without a winner prize and restores progress from its durable receipt', () => {
  beginLocalRanked('ranked-loss', arena.id);
  const reward = settleLocalRanked(ended('ranked-loss', false));
  expect(reward.prize).toBe(0);
  expect(reward.xp).toBe(matchXp({ won: false, goals: 1, xpMultiplier: arena.xpMultiplier }, progressionConfig));
  profileStore.set({ knownXP: 0, knownLevel: 1 });
  restoreLocalRankedProgress();
  expect(profileStore.get().knownXP).toBe(reward.xp);
});
it('rejects uncharged results and insufficient balances without granting anything', () => {
  expect(() => settleLocalRanked(ended('uncharged'))).toThrow('Entry not charged');
  localInventory.set({ coins: 0 });
  expect(() => beginLocalRanked('poor', arena.id)).toThrow('Not enough coins');
  expect(profileStore.get().knownXP).toBe(0);
});

it.each(['local_ai', 'local_pvp', 'tutorial'] as const)(
  'awards development XP once for %s and preserves it across ranked play',
  (mode) => {
    const final = { ...ended(`practice-${mode}`), mode };
    const reward = settleLocalPractice(final)!;
    expect(reward.xp).toBeGreaterThan(0);
    expect(reward.prize).toBe(0);
    expect(reward.entryFee).toBe(0);
    const coins = localInventory.get().coins;
    expect(settleLocalPractice(final)).toEqual(reward);
    expect(profileStore.get().knownXP).toBe(reward.xp);
    expect(localInventory.get().coins).toBe(coins);
    beginLocalRanked('after-practice', arena.id);
    const onlineReward = settleLocalRanked(ended('after-practice', false));
    expect(profileStore.get().knownXP).toBe(reward.xp + onlineReward.xp);
    profileStore.set({ knownXP: 0, knownLevel: 1 });
    restoreLocalRankedProgress();
    expect(profileStore.get().knownXP).toBe(reward.xp + onlineReward.xp);
  },
);
it('awards practice loss XP and grants level-up rewards only once', () => {
  profileStore.set({ knownXP: 95 });
  const reward = settleLocalPractice(ended('practice-level-up', false))!;
  expect(reward.xp).toBeGreaterThan(0);
  expect(reward.levelAfter).toBeGreaterThan(reward.levelBefore);
  expect(profileStore.get().pendingLevelUps).toContain(2);
  const coins = localInventory.get().coins;
  settleLocalPractice(ended('practice-level-up', false));
  expect(localInventory.get().coins).toBe(coins);
});
