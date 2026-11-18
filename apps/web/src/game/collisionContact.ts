import { physicsConfig } from '@flickkick/config';
import type { BodyState } from '@flickkick/sim';
import type { Impact } from './ecs/systems';
import type { CollisionKind } from './ImpactEffects';

/** Estimate the contact surface from the recorded collision frame, rather than the car centre. */
export function collisionContact(impact: Impact, bodies: readonly BodyState[]) {
  const current = bodies[impact.index];
  const radius = current?.kind === 'ball' ? physicsConfig.ball.radius : physicsConfig.disc.radius;
  let other = -1,
    nearest = Infinity;
  bodies.forEach((body, index) => {
    if (index === impact.index) return;
    const distance = Math.hypot(body.x - impact.x, body.y - impact.y);
    const otherRadius = body.kind === 'ball' ? physicsConfig.ball.radius : physicsConfig.disc.radius;
    if (distance < radius + otherRadius + 0.25 && distance < nearest) {
      other = index;
      nearest = distance;
    }
  });
  if (other >= 0) {
    const body = bodies[other]!;
    const f = radius / Math.max(0.001, nearest);
    return {
      x: impact.x + (body.x - impact.x) * f,
      y: impact.y + (body.y - impact.y) * f,
      kind: (current?.kind === 'ball' || body.kind === 'ball' ? 'ball' : 'car') as CollisionKind,
      bodies: [impact.index, other],
    };
  }
  let x = impact.x,
    y = impact.y;
  if (impact.nearWall) {
    const arena = physicsConfig.arena;
    if (arena.halfWidth - Math.abs(x) < arena.halfHeight - Math.abs(y)) x = Math.sign(x) * arena.halfWidth;
    else y = Math.sign(y) * arena.halfHeight;
  }
  return {
    x,
    y,
    kind: (impact.nearWall ? 'wall' : current?.kind === 'ball' ? 'ball' : 'car') as CollisionKind,
    bodies: [impact.index],
  };
}
