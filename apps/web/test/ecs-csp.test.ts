// The production CSP has no 'unsafe-eval'. Koota generates code with
// `new Function` for schema (SoA) traits, which would crash the deployed app
// before it renders. This test forbids Function-based code generation, then
// loads and exercises the whole ECS layer.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { rulesConfig } from '@flickkick/config';
import { createMatch } from '@flickkick/rules';

const RealFunction = globalThis.Function;

beforeAll(() => {
  const blocked = new Proxy(RealFunction, {
    apply() {
      throw new EvalError('Function() is blocked (CSP: no unsafe-eval)');
    },
    construct() {
      throw new EvalError('new Function() is blocked (CSP: no unsafe-eval)');
    },
  });
  globalThis.Function = blocked;
  vi.resetModules();
});

afterAll(() => {
  globalThis.Function = RealFunction;
});

describe('ECS under a no-eval CSP', () => {
  it('defines traits, builds a match world and runs every system without code generation', async () => {
    const traits = await import('../src/game/ecs/traits');
    const systems = await import('../src/game/ecs/systems');
    const state = createMatch({
      matchId: 'csp',
      mode: 'local_pvp',
      rngSeed: 3,
      rules: rulesConfig,
      players: [
        { id: 'a', displayName: 'A', level: 1, teamId: 'team_volt', isBot: false },
        { id: 'b', displayName: 'B', level: 1, teamId: 'team_coral', isBot: false },
      ],
    });
    const world = systems.createMatchWorld(state);
    const n = state.bodies.length;
    world.set(traits.PlaybackTrait, {
      active: true,
      side: 'L',
      shot: null,
      frames: new Float32Array(2 * n * 2),
      bodyCount: n,
      ticks: 1,
      elapsedMs: 0,
      lastFrame: 0,
    });
    world.set(traits.HudTrait, { thinkingSide: null, turnEndsAt: 1, paused: false, canAim: true, reconnecting: false });
    systems.runFrame(world, { deltaMs: 100, nowMs: 0, reducedMotion: false, onShotFinished: () => undefined });
    const disc = systems.bodyEntities(world)[0]!;
    disc.add(traits.Aiming({ angle: 1, power: 0.5, pointerId: 1 }));
    disc.set(traits.Aiming, { angle: 2, power: 0.6, pointerId: 1 });
    systems.clearAiming(world);
    expect(world.get(traits.HudTrait)!.canAim).toBe(true);
    expect(disc.get(traits.Position)).not.toBe(disc.get(traits.Target)); // separate AoS objects
    world.destroy();
  });
});
