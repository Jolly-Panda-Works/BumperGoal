import type { Group, Vector3 } from 'three';
import type { Entity } from 'koota';
import type { MatchState, Side } from '@flickkick/rules';
import { Aiming, BodyRef, IsBall, Position, Target, Team } from './ecs/traits';
import { arenaPosition } from './arena3dProjection';

export function kickoffCarHeading(side: Side, orientation: number): number {
  return (side === 'L' ? Math.PI : 0) + (orientation === -1 ? Math.PI : 0);
}

/** Reset presentation from the authoritative kickoff, including headings and ball roll. */
export function resetKickoffViews(
  views: { entity: Entity; object: Group; last: Vector3 }[],
  state: MatchState,
  orientation: number,
): void {
  for (const view of views) {
    const body = state.bodies[view.entity.get(BodyRef)!.index];
    if (!body) continue;
    const position = view.entity.get(Position)!;
    const target = view.entity.get(Target)!;
    position.x = target.x = body.x;
    position.y = target.y = body.y;
    const point = arenaPosition(body.x, body.y, orientation);
    view.object.position.set(point.x, 0, point.z);
    view.last.copy(view.object.position);
    if (view.entity.has(Aiming)) view.entity.remove(Aiming);
    if (view.entity.has(IsBall)) {
      view.object.rotation.set(0, 0, 0);
      view.object.children[0]?.quaternion.identity();
    } else {
      view.object.rotation.set(0, kickoffCarHeading(view.entity.get(Team)!.side, orientation), 0);
    }
  }
}
