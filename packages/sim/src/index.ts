// Deterministic shot simulation on Rapier (@dimforge/rapier2d-deterministic 0.21.0,
// Rust rapier2d 0.36.0 with `enhanced-determinism`).
//
// The JS side uses the official Rapier API through the `-compat` loader, whose
// embedded wasm is byte-identical to @dimforge/rapier2d-deterministic
// (sha256 0570d5c8…, checked by a test). The Nakama Go plugin runs the same
// wasm bytes in wazero and replays the raw calls this file makes, so anything
// that changes the order or values of physics calls here must change in
// server/nakama/sim too. Read-only queries may differ freely.
import RAPIER from '@dimforge/rapier2d-deterministic-compat';
import type { PhysicsConfig } from '@flickkick/config';

/** Bump when simulation behaviour changes. Part of the match protocol. */
export const SIM_VERSION = 3;
export const RAPIER_VERSION = '0.21.0';

export type BodyKind = 'disc' | 'ball';

/** A body at rest. x and y are always exact f32 values. */
export interface BodyState {
  kind: BodyKind;
  x: number;
  y: number;
}

/** Linear impulse applied to the centre of one body. Components are f32. */
export interface Impulse {
  bodyIndex: number;
  ix: number;
  iy: number;
}

export type ShotOutcome = 'settled' | 'goal_left' | 'goal_right' | 'timeout' | 'invalid';

export interface ShotResult {
  outcome: ShotOutcome;
  ticks: number;
  /** Final positions (velocities are discarded: every turn starts at rest). */
  bodies: BodyState[];
  /** Canonical state hash of `bodies` (see hashBodies). */
  hash: string;
  /** Recorded positions, frame-major: [frame][body][x,y]. Frame 0 = start. */
  frames: Float32Array | null;
}

export interface SimulateOptions {
  recordFrames?: boolean;
  maxSteps?: number;
}

/** Rapier's default fixed step (IntegrationParameters::dt). Never changed. */
export const TIME_STEP_SECONDS = 1 / 60;

const fround = Math.fround;

/** FNV-1a over the f32 bit patterns of kind/x/y. Mirrored in Go (server/nakama/sim). */
export function hashBodies(bodies: readonly BodyState[]): string {
  const view = new DataView(new ArrayBuffer(4));
  let h = 0x811c9dc5;
  const mix = (byte: number) => {
    h ^= byte;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  for (const b of bodies) {
    mix(b.kind === 'ball' ? 1 : 0);
    for (const v of [b.x, b.y]) {
      view.setFloat32(0, v, true);
      for (let i = 0; i < 4; i++) mix(view.getUint8(i));
    }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function toF32Bodies(bodies: readonly BodyState[]): BodyState[] {
  return bodies.map((b) => ({ kind: b.kind, x: fround(b.x), y: fround(b.y) }));
}

let initPromise: Promise<void> | null = null;

/** Loads the Rapier wasm once per JS realm (page, worker, test process). */
export function initPhysics(): Promise<void> {
  initPromise ??= RAPIER.init().catch((err: unknown) => {
    initPromise = null;
    throw err;
  });
  return initPromise;
}

export const MAX_BODIES = 32;

export class FlickSim {
  private constructor(readonly config: PhysicsConfig) {}

  static async create(config: PhysicsConfig): Promise<FlickSim> {
    await initPhysics();
    return new FlickSim(config);
  }

  get maxBodies(): number {
    return MAX_BODIES;
  }

  /** Mass of a body kind (density × area), used to reason about impulses. */
  massOf(kind: BodyKind): number {
    const p = kind === 'ball' ? this.config.ball : this.config.disc;
    return fround(p.density * Math.PI * p.radius * p.radius);
  }

  /**
   * Simulates one shot in a freshly built world from `bodies` (all at rest).
   * Deterministic: identical inputs give bit-identical results on every host
   * running this wasm (browser, Node, Go/wazero).
   */
  simulateShot(bodies: readonly BodyState[], impulse: Impulse, options: SimulateOptions = {}): ShotResult {
    const { config } = this;
    const n = bodies.length;
    if (n === 0 || n > MAX_BODIES) throw new Error(`invalid body count ${n}`);
    if (!Number.isInteger(impulse.bodyIndex) || impulse.bodyIndex < 0 || impulse.bodyIndex >= n) {
      throw new Error(`invalid body index ${impulse.bodyIndex}`);
    }
    if (!this.isSane(bodies) || !Number.isFinite(impulse.ix) || !Number.isFinite(impulse.iy)) {
      return { outcome: 'invalid', ticks: 0, bodies: [...bodies], hash: hashBodies(bodies), frames: null };
    }
    const maxSteps = options.maxSteps ?? config.maxStepsPerShot;
    const a = config.arena;

    // ---- world construction (order matters: mirrored in Go) ----
    const world = new RAPIER.World({ x: 0, y: 0 });
    try {
      const walls = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
      for (const [x1, y1, x2, y2] of arenaSegments(config)) {
        world.createCollider(
          RAPIER.ColliderDesc.segment({ x: x1, y: y1 }, { x: x2, y: y2 })
            .setRestitution(a.wallRestitution)
            .setFriction(0),
          walls,
        );
      }
      const handles = bodies.map((b) => {
        const p = b.kind === 'ball' ? config.ball : config.disc;
        const body = world.createRigidBody(
          RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(b.x, b.y)
            .setLinearDamping(p.linearDamping)
            .lockRotations()
            .setCanSleep(false)
            .setCcdEnabled(b.kind === 'ball'),
        );
        world.createCollider(
          RAPIER.ColliderDesc.ball(p.radius).setDensity(p.density).setRestitution(p.restitution).setFriction(0),
          body,
        );
        return body;
      });
      handles[impulse.bodyIndex]!.applyImpulse({ x: impulse.ix, y: impulse.iy }, true);

      // ---- stepping ----
      const frames = options.recordFrames ? new Float32Array((maxSteps + 1) * n * 2) : null;
      const positions = new Float32Array(n * 2);
      const readPositions = () => {
        for (let i = 0; i < n; i++) {
          const t = handles[i]!.translation();
          positions[i * 2] = t.x;
          positions[i * 2 + 1] = t.y;
        }
      };
      readPositions();
      frames?.set(positions, 0);

      const stop2 = a.stopSpeed * a.stopSpeed;
      const ballIndex = bodies.findIndex((b) => b.kind === 'ball');
      let outcome: ShotOutcome = 'timeout';
      let ticks = 0;
      for (let step = 0; step < maxSteps; step++) {
        world.step();
        ticks = step + 1;
        if (frames) {
          readPositions();
          frames.set(positions, ticks * n * 2);
        } else if (ballIndex >= 0) {
          // AI predictions need only the ball for goal checks, then final positions.
          const ball = handles[ballIndex]!.translation();
          positions[ballIndex * 2] = ball.x;
          positions[ballIndex * 2 + 1] = ball.y;
        }

        if (ballIndex >= 0) {
          const bx = positions[ballIndex * 2]!;
          const by = positions[ballIndex * 2 + 1]!;
          if (by < a.goalHalfWidth && by > -a.goalHalfWidth) {
            if (bx < -a.halfWidth) {
              outcome = 'goal_left';
              break;
            }
            if (bx > a.halfWidth) {
              outcome = 'goal_right';
              break;
            }
          }
        }

        // Low-velocity stabilisation: slow bodies snap to rest so shots always end.
        let moving = false;
        for (let i = 0; i < n; i++) {
          const v = handles[i]!.linvel();
          const speed2 = v.x * v.x + v.y * v.y;
          if (speed2 < stop2) {
            if (speed2 > 0) handles[i]!.setLinvel({ x: 0, y: 0 }, true);
          } else {
            moving = true;
          }
        }
        if (!moving) {
          outcome = 'settled';
          break;
        }
      }

      if (!frames) readPositions();

      const finalBodies: BodyState[] = bodies.map((b, i) => ({
        kind: b.kind,
        x: positions[i * 2]!,
        y: positions[i * 2 + 1]!,
      }));
      if (!this.isSane(finalBodies)) outcome = 'invalid';
      return {
        outcome,
        ticks,
        bodies: finalBodies,
        hash: hashBodies(finalBodies),
        frames: frames ? frames.slice(0, (ticks + 1) * n * 2) : null,
      };
    } finally {
      world.free();
    }
  }

  /** NaN/inf or a body far outside the arena means the simulation is invalid. */
  private isSane(bodies: readonly BodyState[]): boolean {
    const a = this.config.arena;
    const limitX = a.halfWidth + a.goalDepth + this.config.boundsMargin;
    const limitY = a.halfHeight + this.config.boundsMargin;
    return bodies.every(
      (b) => Number.isFinite(b.x) && Number.isFinite(b.y) && Math.abs(b.x) <= limitX && Math.abs(b.y) <= limitY,
    );
  }
}

/** Static arena boundary: long walls, short walls with goal mouths, goal pockets. */
export function arenaSegments(config: PhysicsConfig): [number, number, number, number][] {
  const { halfWidth: w, halfHeight: h, goalHalfWidth: g, goalDepth: d, cornerChamfer: c } = config.arena;
  return [
    [-w + c, h, w - c, h],
    [-w + c, -h, w - c, -h],
    // 45° corner cuts: in a square corner every reachable hit pushes the ball into both walls.
    [-w, h - c, -w + c, h],
    [w - c, h, w, h - c],
    [-w, -h + c, -w + c, -h],
    [w - c, -h, w, -h + c],
    [-w, h - c, -w, g],
    [-w, -g, -w, -h + c],
    [-w, g, -w - d, g],
    [-w - d, g, -w - d, -g],
    [-w - d, -g, -w, -g],
    [w, h - c, w, g],
    [w, -g, w, -h + c],
    [w, g, w + d, g],
    [w + d, g, w + d, -g],
    [w + d, -g, w, -g],
  ];
}
