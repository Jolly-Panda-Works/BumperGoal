import type { PhysicsConfig } from '@flickkick/config';
import type { Side } from '../types';

export interface Vec {
  x: number;
  y: number;
}

export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const len = (v: Vec): number => Math.hypot(v.x, v.y);
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (v: Vec): Vec => {
  const l = len(v);
  return l > 1e-9 ? { x: v.x / l, y: v.y / l } : { x: 1, y: 0 };
};
export const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
export const rotate = (v: Vec, radians: number): Vec => {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
};

/** Centre of the goal mouth that `side` attacks. */
export function attackGoal(side: Side, physics: PhysicsConfig): Vec {
  return { x: side === 'L' ? physics.arena.halfWidth : -physics.arena.halfWidth, y: 0 };
}

export function ownGoal(side: Side, physics: PhysicsConfig): Vec {
  return { x: side === 'L' ? -physics.arena.halfWidth : physics.arena.halfWidth, y: 0 };
}

/** Distance from p to segment ab. */
export function distToSegment(p: Vec, a: Vec, b: Vec): number {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / Math.max(dot(ab, ab), 1e-9)));
  return dist(p, { x: a.x + ab.x * t, y: a.y + ab.y * t });
}
