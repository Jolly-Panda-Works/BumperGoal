import { describe, expect, it } from 'vitest';
import { progressionConfig as cfg } from '@flickkick/config';
import { levelFromXp, levelProgress, levelUpRewards, matchXp, xpForLevel } from '../src/index';

describe('progression', () => {
  it('level thresholds are strictly increasing from 0', () => {
    expect(xpForLevel(1, cfg)).toBe(0);
    for (let l = 2; l <= cfg.maxLevel; l++) expect(xpForLevel(l, cfg)).toBeGreaterThan(xpForLevel(l - 1, cfg));
  });

  it('levelFromXp inverts the thresholds and caps at maxLevel', () => {
    for (let l = 1; l <= cfg.maxLevel; l++) {
      expect(levelFromXp(xpForLevel(l, cfg), cfg)).toBe(l);
      if (l > 1) expect(levelFromXp(xpForLevel(l, cfg) - 1, cfg)).toBe(l - 1);
    }
    expect(levelFromXp(1e12, cfg)).toBe(cfg.maxLevel);
  });

  it('levelProgress reports progress inside the level', () => {
    const p = levelProgress(xpForLevel(3, cfg) + 10, cfg);
    expect(p).toEqual({ level: 3, current: 10, needed: xpForLevel(4, cfg) - xpForLevel(3, cfg) });
  });

  it('match XP rewards wins, goals and arena multiplier', () => {
    expect(matchXp({ won: true, goals: 2, xpMultiplier: 1 }, cfg)).toBe(cfg.xp.win + 2 * cfg.xp.perGoal);
    expect(matchXp({ won: false, goals: 0, xpMultiplier: 1 }, cfg)).toBe(cfg.xp.loss);
    expect(matchXp({ won: true, goals: 0, xpMultiplier: 1.5 }, cfg)).toBe(Math.round(cfg.xp.win * 1.5));
  });

  it('level-up rewards sum every level gained, including gem milestones', () => {
    expect(levelUpRewards(1, 1, cfg)).toEqual({ coins: 0, gems: 0 });
    expect(levelUpRewards(1, 2, cfg)).toEqual({ coins: 200, gems: 0 });
    expect(levelUpRewards(4, 5, cfg)).toEqual({ coins: 500, gems: cfg.levelReward.gemsAmount });
  });
});
