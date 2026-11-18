// ShotEvaluator: scores a simulated outcome from the shooter's perspective.
import type { AIProfile, PhysicsConfig } from '@flickkick/config';
import type { ShotResult } from '@flickkick/sim';
import { discIndicesOf } from '../match';
import { otherSide, type MatchState, type Side } from '../types';
import { attackGoal, dist, distToSegment, ownGoal } from './geometry';

export const GOAL_SCORE = 1000;

export function evaluateOutcome(
  state: MatchState,
  side: Side,
  result: ShotResult,
  profile: AIProfile,
  physics: PhysicsConfig,
): number {
  const scoredGoal = side === 'L' ? 'goal_right' : 'goal_left';
  const concededGoal = side === 'L' ? 'goal_left' : 'goal_right';
  if (result.outcome === scoredGoal) return GOAL_SCORE;
  if (result.outcome === concededGoal) return -GOAL_SCORE * (2 - profile.riskTolerance);
  if (result.outcome === 'invalid') return -GOAL_SCORE;

  const bodies = result.bodies;
  const ball = bodies[bodies.length - 1]!;
  const goal = attackGoal(side, physics);
  const home = ownGoal(side, physics);
  const sign = side === 'L' ? 1 : -1;

  // Match situation: protect a lead, push when behind late in the match.
  const lead = state.score[side] - state.score[otherSide(side)];
  const late = state.shotCount / Math.max(1, state.maxShots);
  const attackBias = lead < 0 ? 1 + late : lead > 0 ? 0.7 : 1;
  const defendBias = lead > 0 ? 1.5 : 1;

  const progress = (sign * ball.x) / physics.arena.halfWidth; // -1 own goal … +1 their goal
  const threat = Math.max(0, 1 - dist(ball, goal) / 6);
  const danger = Math.max(0, 1 - dist(ball, home) / 6);

  // Coverage: own discs on the line between the ball and our goal.
  let coverage = 0;
  for (const i of discIndicesOf(state, side)) {
    const d = bodies[i]!;
    if (distToSegment(d, ball, home) < physics.disc.radius + physics.ball.radius + 0.25) coverage++;
  }

  const w = profile.defensiveWeight;
  return (
    100 * progress * attackBias +
    80 * threat * (0.5 + profile.riskTolerance) * attackBias -
    90 * danger * w * defendBias +
    25 * Math.min(coverage, 2) * w * defendBias
  );
}
