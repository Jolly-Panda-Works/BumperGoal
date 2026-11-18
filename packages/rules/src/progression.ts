import type { Price, ProgressionConfig } from '@flickkick/config';

/** Total XP needed to reach `level` (level 1 = 0 XP). */
export function xpForLevel(level: number, config: ProgressionConfig): number {
  if (level <= 1) return 0;
  return Math.round(config.levelCurve.base * Math.pow(level - 1, config.levelCurve.exponent));
}

export function levelFromXp(xp: number, config: ProgressionConfig): number {
  let level = 1;
  while (level < config.maxLevel && xp >= xpForLevel(level + 1, config)) level++;
  return level;
}

/** Progress inside the current level, for XP bars. */
export function levelProgress(
  xp: number,
  config: ProgressionConfig,
): { level: number; current: number; needed: number } {
  const level = levelFromXp(xp, config);
  if (level >= config.maxLevel) return { level, current: 0, needed: 0 };
  const floor = xpForLevel(level, config);
  return { level, current: xp - floor, needed: xpForLevel(level + 1, config) - floor };
}

export function matchXp(
  input: { won: boolean; goals: number; xpMultiplier: number },
  config: ProgressionConfig,
): number {
  const base = (input.won ? config.xp.win : config.xp.loss) + config.xp.perGoal * Math.max(0, input.goals);
  return Math.round(base * input.xpMultiplier);
}

/** Rewards for every level gained when moving from `from` to `to` (exclusive of `from`). */
export function levelUpRewards(from: number, to: number, config: ProgressionConfig): Required<Price> {
  const total = { coins: 0, gems: 0 };
  for (let level = from + 1; level <= to; level++) {
    total.coins += config.levelReward.coinsPerLevel * level;
    if (level % config.levelReward.gemsEveryNLevels === 0) total.gems += config.levelReward.gemsAmount;
  }
  return total;
}
