// ECS systems. Pure functions over a Koota world: no Phaser, no React, so they
// run in unit tests. The Phaser scene calls them once per frame.
import { createWorld, type Entity, type World } from 'koota';
import { physicsConfig } from '@flickkick/config';
import { discOwner, type MatchState } from '@flickkick/rules';
import {
  Aiming,
  BodyRef,
  EventsTrait,
  Highlighted,
  Heading,
  HoldTrait,
  HudTrait,
  IsBall,
  IsDisc,
  MatchTrait,
  PlaybackTrait,
  Position,
  Target,
  Team,
  View,
} from './traits';

export const FRAME_MS = 1000 / 60;

/** Creates the match world: world traits plus one entity per physics body. */
export function createMatchWorld(state: MatchState): World {
  const world = createWorld();
  world.add(MatchTrait({ state }), HudTrait, EventsTrait, PlaybackTrait, HoldTrait);
  state.bodies.forEach((b, index) => {
    // AoS traits keep the object they are given: Position and Target need their own.
    const position = Position({ x: b.x, y: b.y });
    const target = Target({ x: b.x, y: b.y });
    const heading = Heading({ angle: b.angle ?? 0, target: b.angle ?? 0 });
    if (b.kind === 'ball') {
      world.spawn(BodyRef({ index }), IsBall, position, target, heading, View);
    } else {
      world.spawn(
        BodyRef({ index }),
        IsDisc,
        Team({ side: discOwner(state, index)! }),
        position,
        target,
        heading,
        View,
      );
    }
  });
  return world;
}

/** Entities ordered by body index (stable lookup for systems and the scene). */
export function bodyEntities(world: World): Entity[] {
  const list: Entity[] = [];
  world.query(BodyRef).forEach((e) => {
    list[e.get(BodyRef)!.index] = e;
  });
  return list;
}

/** Copies canonical positions into Target whenever the match state changes. */
export function syncTargetsSystem(world: World): void {
  const state = world.get(MatchTrait)?.state;
  if (!state || world.get(PlaybackTrait)?.active) return;
  world.query(BodyRef, Target).updateEach(([ref, target]) => {
    const b = state.bodies[ref.index];
    if (!b) return;
    target.x = b.x;
    target.y = b.y;
  });
  world.query(BodyRef, Heading).updateEach(([ref, heading]) => {
    heading.target = state.bodies[ref.index]?.angle ?? 0;
  });
}

export interface Impact {
  index: number;
  x: number;
  y: number;
  strength: number;
  nearWall: boolean;
}

/**
 * Advances recorded-frame playback. Writes Position (and Target, so easing is
 * a no-op during playback), reports impacts from velocity changes between
 * frames, and returns true on the frame the playback finishes.
 */
export function playbackSystem(world: World, deltaMs: number, onImpact?: (impact: Impact) => void): boolean {
  const pb = world.get(PlaybackTrait);
  if (!pb?.active) return false;
  pb.elapsedMs += Math.min(deltaMs, 100);
  const n = pb.bodyCount;
  const frames = pb.frames;
  const frame = pb.elapsedMs / FRAME_MS;
  const done = frame >= pb.ticks;
  const f0 = done ? pb.ticks : Math.floor(frame);
  const t = done ? 0 : frame - f0;
  const f1 = Math.min(f0 + 1, pb.ticks);

  world.query(BodyRef, Position, Target).updateEach(([ref, pos, target]) => {
    const a = (f0 * n + ref.index) * 2;
    const b = (f1 * n + ref.index) * 2;
    pos.x = frames[a]! + (frames[b]! - frames[a]!) * t;
    pos.y = frames[a + 1]! + (frames[b + 1]! - frames[a + 1]!) * t;
    target.x = pos.x;
    target.y = pos.y;
  });

  if (pb.angles.length)
    world.query(BodyRef, Heading).updateEach(([ref, heading]) => {
      const a = pb.angles[f0 * n + ref.index]!;
      const b = pb.angles[f1 * n + ref.index]!;
      heading.angle = a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
      heading.target = heading.angle;
    });

  if (onImpact) {
    const arena = physicsConfig.arena;
    for (let f = Math.max(2, pb.lastFrame + 1); f <= f0; f++) {
      for (let i = 0; i < n; i++) {
        const current = (f * n + i) * 2;
        const previous = current - n * 2;
        const before = previous - n * 2;
        const x = frames[current]!;
        const y = frames[current + 1]!;
        const dv = Math.hypot(
          x - 2 * frames[previous]! + frames[before]!,
          y - 2 * frames[previous + 1]! + frames[before + 1]!,
        );
        if (dv > 0.03) {
          const nearWall = Math.abs(y) > arena.halfHeight - 0.6 || Math.abs(x) > arena.halfWidth - 0.6;
          onImpact({ index: i, x, y, strength: dv, nearWall });
        }
      }
    }
  }
  pb.lastFrame = Math.max(pb.lastFrame, f0);
  if (done) pb.active = false;
  return done;
}

/** Eases Position towards Target (kickoff resets, server corrections). */
export function easeSystem(world: World, deltaMs: number, nowMs: number, instant: boolean): void {
  if ((world.get(HoldTrait)?.until ?? 0) > nowMs) return;
  const k = instant ? 1 : 1 - Math.exp(-deltaMs / 90);
  world.query(Position, Target).updateEach(([pos, target]) => {
    const dx = target.x - pos.x;
    const dy = target.y - pos.y;
    if (Math.abs(dx) < 1e-4 && Math.abs(dy) < 1e-4) {
      pos.x = target.x;
      pos.y = target.y;
      return;
    }
    pos.x += dx * k;
    pos.y += dy * k;
  });
  world.query(Heading).updateEach(([heading]) => {
    const delta = Math.atan2(Math.sin(heading.target - heading.angle), Math.cos(heading.target - heading.angle));
    heading.angle = instant || Math.abs(delta) < 1e-4 ? heading.target : heading.angle + delta * k;
  });
}

/** Tags the discs of the side to move, while a shot is awaited and the board is idle. */
export function highlightSystem(world: World, nowMs: number): void {
  const state = world.get(MatchTrait)?.state;
  const idle =
    !!state &&
    state.phase === 'AWAIT_SHOT' &&
    !world.get(PlaybackTrait)?.active &&
    (world.get(HoldTrait)?.until ?? 0) <= nowMs;
  world.query(IsDisc, Team).forEach((e) => {
    const on = idle && e.get(Team)!.side === state!.turn.side;
    if (on && !e.has(Highlighted)) e.add(Highlighted);
    if (!on && e.has(Highlighted)) e.remove(Highlighted);
  });
}

/** Clears any aiming state (turn changed, shot submitted, input cancelled). */
export function clearAiming(world: World): void {
  world.query(Aiming).forEach((e) => e.remove(Aiming));
}

export interface FrameOptions {
  deltaMs: number;
  nowMs: number;
  reducedMotion: boolean;
  onImpact?: (impact: Impact) => void;
  /**
   * Called on the frame the shot animation ends. Must apply the shot result to
   * MatchTrait synchronously (MatchController.completeShot does), so that the
   * sync below already sees the post-shot state.
   */
  onShotFinished: () => void;
}

/**
 * One frame of the match runtime, in the only safe order. Applying the shot
 * result before syncing targets is what prevents the board from easing back to
 * the pre-shot positions for a moment when the turn passes.
 */
export function runFrame(world: World, o: FrameOptions): void {
  if (playbackSystem(world, o.deltaMs, o.onImpact)) o.onShotFinished();
  syncTargetsSystem(world);
  easeSystem(world, o.deltaMs, o.nowMs, o.reducedMotion);
  highlightSystem(world, o.nowMs);
}

export function readHud(world: World) {
  return world.get(HudTrait)!;
}

export function readEvents(world: World) {
  return world.get(EventsTrait)!;
}
