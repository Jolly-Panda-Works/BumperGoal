import { describe, expect, it } from 'vitest';
import { Group, Vector3 } from 'three';
import { rulesConfig } from '@flickkick/config';
import { applyShotResult, createMatch } from '@flickkick/rules';
import { hashBodies, type BodyState } from '@flickkick/sim';
import { createMatchWorld, bodyEntities } from '../src/game/ecs/systems';
import { Aiming, IsBall, Position, Target } from '../src/game/ecs/traits';
import { arenaPosition } from '../src/game/arena3dProjection';
import { resetKickoffViews } from '../src/game/kickoffPresentation';

describe('goal kickoff presentation', () => {
  for (const orientation of [1, -1]) {
    it(`restores both teams and the ball completely for board orientation ${orientation}`, () => {
      const state = createMatch({
        matchId: 'reset',
        mode: 'local_pvp',
        rngSeed: 3,
        rules: rulesConfig,
        players: [
          { id: 'a', displayName: 'A', level: 1, teamId: 'team_volt', isBot: false },
          { id: 'b', displayName: 'B', level: 1, teamId: 'team_coral', isBot: false },
        ],
      });
      const world = createMatchWorld(state);
      const moved: BodyState[] = state.bodies.map((body, index) => ({ ...body, x: index * 0.2, y: 2 }));
      const result = applyShotResult(
        state,
        'L',
        { seq: state.turn.seq, discIndex: 0, ix: 1, iy: 0 },
        { outcome: 'goal_right', ticks: 1, bodies: moved, hash: hashBodies(moved), frames: null },
        rulesConfig,
      );
      expect(result.state.score.L).toBe(1);
      const views = bodyEntities(world).map((entity, index) => {
        entity.get(Position)!.x = moved[index]!.x;
        entity.get(Position)!.y = moved[index]!.y;
        entity.get(Target)!.x = 99;
        entity.add(Aiming({ angle: 0.8, power: 1, pointerId: 1 }));
        const object = new Group();
        object.position.set(4, 0, 3);
        object.rotation.set(0.2, 0.9, 0.4);
        if (entity.has(IsBall)) {
          const ball = new Group();
          ball.position.y = 0.22;
          ball.rotation.set(1, 2, 3);
          object.add(ball);
        }
        return { entity, object, last: new Vector3(7, 0, 8) };
      });
      resetKickoffViews(views, result.state, orientation);
      views.forEach((view, index) => {
        const body = state.bodies[index]!;
        expect(view.entity.get(Position)).toEqual({ x: body.x, y: body.y });
        expect(view.entity.get(Target)).toEqual({ x: body.x, y: body.y });
        const point = arenaPosition(body.x, body.y, orientation);
        expect(view.object.position.toArray()).toEqual([point.x, 0, point.z]);
        expect(view.last.toArray()).toEqual(view.object.position.toArray());
        expect(view.entity.has(Aiming)).toBe(false);
        if (body.kind === 'ball') {
          expect(view.object.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
          expect(view.object.children[0]!.quaternion.toArray()).toEqual([0, 0, 0, 1]);
          expect(view.object.children[0]!.position.y).toBe(0.22);
        } else {
          const expected = (index < state.discsPerTeam ? Math.PI : 0) + (orientation === -1 ? Math.PI : 0);
          expect(view.object.rotation.y).toBeCloseTo(expected);
          expect(view.object.rotation.x).toBe(0);
          expect(view.object.rotation.z).toBe(0);
        }
      });
      expect(result.state.bodies).toEqual(state.bodies);
      world.destroy();
    });
  }
});
