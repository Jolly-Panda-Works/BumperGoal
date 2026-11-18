import { describe, expect, it } from 'vitest';
import { rulesConfig } from '@flickkick/config';
import { createMatch, type MatchState } from '@flickkick/rules';
import {
  bodyEntities,
  createMatchWorld,
  easeSystem,
  highlightSystem,
  playbackSystem,
  syncTargetsSystem,
  FRAME_MS,
} from '../src/game/ecs/systems';
import {
  Highlighted,
  HoldTrait,
  IsBall,
  IsDisc,
  MatchTrait,
  PlaybackTrait,
  Position,
  Target,
  Team,
} from '../src/game/ecs/traits';

function match(): MatchState {
  return createMatch({
    matchId: 'ecs',
    mode: 'local_pvp',
    rngSeed: 2,
    rules: rulesConfig,
    players: [
      { id: 'a', displayName: 'A', level: 1, teamId: 'team_volt', isBot: false },
      { id: 'b', displayName: 'B', level: 1, teamId: 'team_coral', isBot: false },
    ],
  });
}

describe('match world', () => {
  it('spawns one entity per body with team and kind tags', () => {
    const state = match();
    const world = createMatchWorld(state);
    const entities = bodyEntities(world);
    expect(entities).toHaveLength(state.bodies.length);
    expect(world.query(IsDisc).length).toBe(rulesConfig.discsPerTeam * 2);
    expect(world.query(IsBall).length).toBe(1);
    expect(entities[0]!.get(Team)!.side).toBe('L');
    expect(entities[rulesConfig.discsPerTeam]!.get(Team)!.side).toBe('R');
    expect(entities.at(-1)!.get(Position)).toEqual({ x: 0, y: 0 });
    world.destroy();
  });

  it('highlights only the discs of the side to move, and not during a hold', () => {
    const state = match();
    const world = createMatchWorld(state);
    highlightSystem(world, 0);
    const lit = world.query(Highlighted).map((e) => e.get(Team)!.side);
    expect(lit).toHaveLength(rulesConfig.discsPerTeam);
    expect(new Set(lit)).toEqual(new Set([state.turn.side]));
    world.set(HoldTrait, { until: 1000 });
    highlightSystem(world, 500);
    expect(world.query(Highlighted).length).toBe(0);
    world.destroy();
  });

  it('plays back recorded frames into Position and reports completion', () => {
    const state = match();
    const world = createMatchWorld(state);
    const n = state.bodies.length;
    const ticks = 3;
    const frames = new Float32Array((ticks + 1) * n * 2);
    for (let f = 0; f <= ticks; f++) for (let i = 0; i < n; i++) frames[(f * n + i) * 2] = f; // x = frame number
    world.set(PlaybackTrait, {
      active: true,
      side: 'L',
      shot: null,
      frames,
      bodyCount: n,
      ticks,
      elapsedMs: 0,
      lastFrame: 0,
    });

    expect(playbackSystem(world, FRAME_MS * 1.5)).toBe(false);
    expect(bodyEntities(world)[0]!.get(Position)!.x).toBeCloseTo(1.5, 5);
    expect(playbackSystem(world, FRAME_MS * 5)).toBe(true);
    expect(bodyEntities(world)[0]!.get(Position)!.x).toBe(3);
    expect(world.get(PlaybackTrait)!.active).toBe(false);
    world.destroy();
  });

  it('syncs targets from a new rules state and eases positions towards them', () => {
    const state = match();
    const world = createMatchWorld(state);
    const moved = { ...state, bodies: state.bodies.map((b, i) => (i === 0 ? { ...b, x: b.x + 2 } : b)) };
    world.set(MatchTrait, { state: moved });
    syncTargetsSystem(world);
    const disc = bodyEntities(world)[0]!;
    expect(disc.get(Target)!.x).toBeCloseTo(state.bodies[0]!.x + 2, 5);
    easeSystem(world, 16, 0, false);
    const halfway = disc.get(Position)!.x;
    expect(halfway).toBeGreaterThan(state.bodies[0]!.x);
    expect(halfway).toBeLessThan(moved.bodies[0]!.x);
    easeSystem(world, 16, 0, true);
    expect(disc.get(Position)!.x).toBeCloseTo(moved.bodies[0]!.x, 5);
    world.destroy();
  });
});

describe('end-of-shot frame (regression: board flashed back to the pre-shot state)', () => {
  it('positions never move back towards the pre-shot board when the turn passes', async () => {
    const { FlickSim } = await import('@flickkick/sim');
    const { physicsConfig } = await import('@flickkick/config');
    const { MatchController } = await import('../src/game/MatchController');
    const { runFrame } = await import('../src/game/ecs/systems');
    const sim = await FlickSim.create(physicsConfig);
    const clock = { now: () => 0, setTimeout: () => 0, clearTimeout: () => undefined };
    const c = new MatchController({
      matchId: 'flash',
      mode: 'local_pvp',
      players: [
        { id: 'a', displayName: 'A', level: 1, teamId: 'team_volt', isBot: false },
        { id: 'b', displayName: 'B', level: 1, teamId: 'team_coral', isBot: false },
      ],
      humanSides: ['L', 'R'],
      sim,
      seed: 4,
      clock,
    });
    c.start();
    const side = c.current.turn.side;
    // A gentle sideways shot of a back disc: moves, does not score.
    const disc = side === 'L' ? 1 : rulesConfig.discsPerTeam + 1;
    const before = c.current.bodies.map((b) => ({ ...b }));
    expect(c.requestShot(disc, Math.PI / 2, 0.35)).toBeNull();

    const entity = bodyEntities(c.world)[disc]!;
    const xs: { x: number; y: number }[] = [];
    let finished = false;
    for (let f = 0; f < 2000 && !finished; f++) {
      runFrame(c.world, {
        deltaMs: 1000 / 60,
        nowMs: f * 16,
        reducedMotion: false,
        onShotFinished: () => {
          finished = true;
          c.completeShot();
        },
      });
      xs.push({ ...entity.get(Position)! });
    }
    expect(finished).toBe(true);
    expect(c.current.turn.side).not.toBe(side);
    const final = c.current.bodies[disc]!;
    // Run a few more frames after the turn passed: the disc must stay on its final spot.
    for (let f = 0; f < 10; f++) {
      runFrame(c.world, { deltaMs: 16, nowMs: 99999, reducedMotion: false, onShotFinished: () => undefined });
      xs.push({ ...entity.get(Position)! });
    }
    const last = xs.slice(-12);
    for (const p of last) {
      expect(p.x).toBeCloseTo(final.x, 6);
      expect(p.y).toBeCloseTo(final.y, 6);
    }
    expect(Math.hypot(final.x - before[disc]!.x, final.y - before[disc]!.y)).toBeGreaterThan(0.1);
    c.dispose();
  });
});
