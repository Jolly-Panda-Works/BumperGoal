// ShotCandidateGenerator: proposes a bounded, prioritised list of shots.
import type { AIProfile, PhysicsConfig } from '@flickkick/config';
import { ballIndex, discIndicesOf } from '../match';
import type { MatchState, Side } from '../types';
import { attackGoal, dist, dot, norm, ownGoal, rotate, sub, type Vec } from './geometry';

export type CandidateKind = 'strike' | 'direct' | 'bank' | 'block';

export interface Candidate {
  discIndex: number;
  dir: Vec;
  power: number;
  kind: CandidateKind;
  prior: number;
}

const DEG = Math.PI / 180;

export function generateCandidates(
  state: MatchState,
  side: Side,
  profile: AIProfile,
  physics: PhysicsConfig,
  budget: number,
): Candidate[] {
  const ball = state.bodies[ballIndex(state)]!;
  const goal = attackGoal(side, physics);
  const home = ownGoal(side, physics);
  const rr = physics.disc.radius + physics.ball.radius;
  const wallY = physics.arena.halfHeight - physics.disc.radius;
  const out: Candidate[] = [];

  const push = (discIndex: number, dir: Vec, kind: CandidateKind, prior: number) => {
    for (const offset of profile.angleOffsetsDeg) {
      const d = offset === 0 ? dir : rotate(dir, offset * DEG);
      for (const power of profile.powerSteps)
        out.push({ discIndex, dir: d, power, kind, prior: prior - Math.abs(offset) * 0.5 });
    }
  };

  const goalTargets: Vec[] = [
    goal,
    { x: goal.x, y: physics.arena.goalHalfWidth * 0.55 },
    { x: goal.x, y: -physics.arena.goalHalfWidth * 0.55 },
  ];

  for (const i of discIndicesOf(state, side)) {
    const disc = state.bodies[i]!;
    const toBall = dist(disc, ball);
    const proximity = 10 - toBall; // closer discs first

    // Strike: hit the ball so it travels towards a point in the goal mouth.
    for (const target of goalTargets) {
      const u = norm(sub(target, ball));
      const ghost = { x: ball.x - u.x * rr, y: ball.y - u.y * rr };
      const dir = norm(sub(ghost, disc));
      if (dot(dir, u) > 0.25) push(i, dir, 'strike', 30 + proximity + dot(dir, u) * 10);
    }

    // Direct: drive straight through the ball.
    push(i, norm(sub(ball, disc)), 'direct', 15 + proximity);

    // Bank: aim at the mirror image of the ghost point across a side wall.
    if (profile.bankShots) {
      const u = norm(sub(goal, ball));
      const ghost = { x: ball.x - u.x * rr, y: ball.y - u.y * rr };
      for (const wall of [wallY, -wallY]) {
        const mirrored = { x: ghost.x, y: 2 * wall - ghost.y };
        push(i, norm(sub(mirrored, disc)), 'bank', 8 + proximity);
      }
    }

    // Block: put a disc between the ball and our own goal.
    if (profile.defensiveWeight >= 0.4) {
      const guard = { x: home.x + (ball.x - home.x) * 0.35, y: home.y + (ball.y - home.y) * 0.35 };
      if (dist(disc, guard) > physics.disc.radius * 2)
        push(i, norm(sub(guard, disc)), 'block', 5 + profile.defensiveWeight * 10);
    }
  }

  out.sort((a, b) => b.prior - a.prior || a.discIndex - b.discIndex || a.power - b.power);
  return out.slice(0, Math.max(1, budget));
}
