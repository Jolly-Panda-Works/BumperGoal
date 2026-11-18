import { describe, expect, it } from 'vitest';
import { createMatchStatistics, trackShot, trackEvents } from '../src/game/matchStatistics';
describe('match observations', () => {
  it('attributes scoring shots, own goals and timeouts to the correct side', () => {
    const stats = createMatchStatistics();
    const shot = { seq: 1, discIndex: 0, ix: 3, iy: 4 };
    trackShot(
      stats,
      'L',
      shot,
      { outcome: 'goal_right', ticks: 120 },
      [{ type: 'goal', scorer: 'L', ownGoal: false, score: { L: 1, R: 0 } }],
      10,
    );
    trackShot(
      stats,
      'R',
      shot,
      { outcome: 'goal_right', ticks: 60 },
      [{ type: 'goal', scorer: 'L', ownGoal: true, score: { L: 2, R: 0 } }],
      10,
    );
    trackEvents(stats, [{ type: 'timeout', side: 'R', consecutive: 1 }]);
    expect(stats.sides.L).toEqual({
      shots: 1,
      scoringShots: 1,
      ownGoals: 0,
      timeouts: 0,
      powerTotal: 50,
      simulationTicks: 120,
    });
    expect(stats.sides.R).toEqual({
      shots: 1,
      scoringShots: 0,
      ownGoals: 1,
      timeouts: 1,
      powerTotal: 50,
      simulationTicks: 60,
    });
  });
  it('does not count rolled-back simulations or mutate the shot inputs', () => {
    const stats = createMatchStatistics();
    const shot = Object.freeze({ seq: 1, discIndex: 0, ix: 3, iy: 4 });
    trackShot(stats, 'L', shot, { outcome: 'invalid', ticks: 99 }, [], 10);
    expect(stats).toEqual(createMatchStatistics());
    trackShot(stats, 'L', shot, { outcome: 'settled', ticks: 30 }, [], 10);
    expect(shot).toEqual({ seq: 1, discIndex: 0, ix: 3, iy: 4 });
    expect(stats.sides.R.shots).toBe(0);
  });
});
