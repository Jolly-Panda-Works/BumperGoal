import type { MatchEvent, Shot, Side } from '@flickkick/rules';
import type { ShotResult } from '@flickkick/sim';
export interface SideStatistics {
  shots: number;
  scoringShots: number;
  ownGoals: number;
  timeouts: number;
  powerTotal: number;
  simulationTicks: number;
}
export interface MatchStatistics {
  version: 1;
  durationMs: number;
  sides: Record<Side, SideStatistics>;
}
const emptySide = (): SideStatistics => ({
  shots: 0,
  scoringShots: 0,
  ownGoals: 0,
  timeouts: 0,
  powerTotal: 0,
  simulationTicks: 0,
});
export const createMatchStatistics = (): MatchStatistics => ({
  version: 1,
  durationMs: 0,
  sides: { L: emptySide(), R: emptySide() },
});
/** Observation only: no changes to rules, simulation inputs or canonical hashes. */
export function trackShot(
  stats: MatchStatistics,
  side: Side,
  shot: Shot,
  result: Pick<ShotResult, 'outcome' | 'ticks'>,
  events: MatchEvent[],
  maxImpulse: number,
): void {
  if (result.outcome === 'invalid') return;
  const own = stats.sides[side];
  own.shots++;
  own.simulationTicks += result.ticks;
  own.powerTotal += Math.min(100, Math.max(0, (Math.hypot(shot.ix, shot.iy) / maxImpulse) * 100));
  for (const event of events)
    if (event.type === 'goal') {
      if (event.ownGoal) own.ownGoals++;
      else if (event.scorer === side) own.scoringShots++;
    }
}
export function trackEvents(stats: MatchStatistics, events: MatchEvent[]): void {
  for (const event of events) if (event.type === 'timeout') stats.sides[event.side].timeouts++;
}
