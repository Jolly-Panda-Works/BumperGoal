// Local match orchestration (local AI, local 2P, tutorial). Plain TypeScript,
// no Phaser or React: the scene renders and collects input, the HUD reads
// snapshots, and every state change goes through @flickkick/rules.
// Online matches use a server-driven controller with the same surface (M7).
import {
  physicsConfig,
  rulesConfig,
  teamPhysics,
  teamAttributes,
  weightScale,
  teamTurnTime,
  type AIProfile,
  type RulesConfig,
} from '@flickkick/config';
import {
  applyShotResult,
  applyTimeout,
  beginShot,
  createMatch,
  forfeit,
  impulseFromAim,
  playerOf,
  validateShot,
  type MatchEvent,
  type MatchMode,
  type MatchState,
  type PlayerInfo,
  type Shot,
  type ShotRejection,
  type Side,
} from '@flickkick/rules';
import type { FlickSim, ShotResult } from '@flickkick/sim';
import type { World } from 'koota';
import { createMatchStatistics, trackShot, trackEvents } from './matchStatistics';
import type { AIClient } from './aiClient';
import { Emitter } from './emitter';
import type { MatchDriver } from './driver';
import { createMatchWorld } from './ecs/systems';
import { EventsTrait, HudTrait, MatchTrait, PlaybackTrait } from './ecs/traits';

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

const browserClock: Clock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => window.clearTimeout(id),
};

export interface ControllerOptions {
  matchId: string;
  mode: Extract<MatchMode, 'local_ai' | 'local_pvp' | 'tutorial'>;
  players: [Omit<PlayerInfo, 'side'>, Omit<PlayerInfo, 'side'>];
  /** Sides controlled by input on this device. */
  humanSides: Side[];
  ai?: { side: Side; profile: AIProfile; client: AIClient };
  sim: FlickSim;
  seed: number;
  rules?: RulesConfig;
  clock?: Clock;
  /** Pause after a goal before the kickoff turn starts. */
  goalPauseMs?: number;
  /** Turn timer; null disables it (tutorial). */
  turnTimeMs?: number | null;
}

export interface ShotPlayback {
  side: Side;
  shot: Shot;
  frames: Float32Array;
  angles?: Float32Array;
  bodyCount: number;
  ticks: number;
  result: ShotResult;
}

export interface ControllerSnapshot {
  state: MatchState;
  thinkingSide: Side | null;
  turnEndsAt: number | null;
  paused: boolean;
  lastEvents: MatchEvent[];
}

export type ControllerEvents = {
  playShot: ShotPlayback;
  events: MatchEvent[];
  rejected: ShotRejection;
  ended: MatchState;
};

export class MatchController implements MatchDriver {
  readonly online = false;
  readonly bus = new Emitter<ControllerEvents>();
  /** Koota world: the controller writes rules state into it; systems and views read it. */
  readonly world: World;
  private state: MatchState;
  private readonly stats = createMatchStatistics();
  private startedAt: number | null = null;
  private endedAt: number | null = null;
  private readonly rules: RulesConfig;
  private readonly clock: Clock;
  private pending: { side: Side; shot: Shot; result: ShotResult } | null = null;
  private thinkingSide: Side | null = null;
  private turnEndsAt: number | null = null;
  private pausedRemaining: number | null = null;
  private timerId: number | null = null;
  private delayId: number | null = null;
  private aiToken = 0;
  private disposed = false;
  private listeners = new Set<() => void>();
  private snapshot: ControllerSnapshot;
  private lastEvents: MatchEvent[] = [];

  constructor(private readonly options: ControllerOptions) {
    this.rules = {
      ...(options.rules ?? rulesConfig),
      carMassScales: options.players.map((p) => weightScale(teamAttributes(p.teamId).weight)) as [number, number],
    };
    this.clock = options.clock ?? browserClock;
    this.state = createMatch({
      matchId: options.matchId,
      mode: options.mode,
      players: options.players,
      rngSeed: options.seed,
      rules: this.rules,
    });
    this.world = createMatchWorld(this.state);
    this.snapshot = this.makeSnapshot();
  }

  // ---- React (useSyncExternalStore) ----
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ControllerSnapshot => this.snapshot;

  private makeSnapshot(): ControllerSnapshot {
    return {
      state: this.state,
      thinkingSide: this.thinkingSide,
      turnEndsAt: this.turnEndsAt,
      paused: this.pausedRemaining !== null,
      lastEvents: this.lastEvents,
    };
  }

  private changed(): void {
    this.snapshot = this.makeSnapshot();
    if (!this.disposed) {
      this.world.set(MatchTrait, { state: this.state });
      this.world.set(HudTrait, {
        thinkingSide: this.thinkingSide,
        turnEndsAt: this.turnEndsAt,
        paused: this.pausedRemaining !== null,
        canAim: this.canAim(),
        reconnecting: false,
      });
    }
    this.listeners.forEach((l) => l());
  }

  get current(): MatchState {
    return this.state;
  }

  get statistics() {
    return {
      ...this.stats,
      durationMs: this.startedAt === null ? 0 : Math.max(0, (this.endedAt ?? this.clock.now()) - this.startedAt),
      sides: { L: { ...this.stats.sides.L }, R: { ...this.stats.sides.R } },
    };
  }

  get sim(): FlickSim {
    return this.options.sim;
  }

  isHuman(side: Side): boolean {
    return this.options.humanSides.includes(side);
  }

  /** True when this device may aim right now. */
  canAim(): boolean {
    return (
      !this.disposed &&
      this.pausedRemaining === null &&
      this.state.phase === 'AWAIT_SHOT' &&
      this.delayId === null &&
      this.isHuman(this.state.turn.side)
    );
  }

  start(): void {
    this.startedAt ??= this.clock.now();
    this.beginTurn();
  }

  // ---- input ----
  requestShot(discIndex: number, angle: number, power: number): ShotRejection | null {
    if (!this.canAim()) return 'not_awaiting_shot';
    const side = this.state.turn.side;
    const shot: Shot = { seq: this.state.turn.seq, discIndex, ...impulseFromAim(angle, power, this.shotPhysics(side)) };
    return this.submit(side, shot);
  }

  private shotPhysics(side: Side) {
    return this.options.mode === 'tutorial'
      ? physicsConfig
      : teamPhysics(playerOf(this.state, side).teamId, physicsConfig);
  }

  private submit(side: Side, shot: Shot): ShotRejection | null {
    const check = validateShot(this.state, side, shot, this.shotPhysics(side));
    if (!check.ok) {
      this.bus.emit('rejected', check.reason);
      return check.reason;
    }
    this.stopTimer();
    const result = this.options.sim.simulateShot(
      this.state.bodies,
      { bodyIndex: shot.discIndex, ix: shot.ix, iy: shot.iy },
      { recordFrames: true },
    );
    this.state = beginShot(this.state);
    this.pending = { side, shot, result };
    this.world.set(PlaybackTrait, {
      active: true,
      side,
      shot,
      frames: result.frames!,
      angles: result.angles ?? new Float32Array(0),
      bodyCount: this.state.bodies.length,
      ticks: result.ticks,
      elapsedMs: 0,
      lastFrame: 0,
    });
    this.changed();
    this.bus.emit('playShot', {
      side,
      shot,
      frames: result.frames!,
      angles: result.angles ?? new Float32Array(0),
      bodyCount: this.state.bodies.length,
      ticks: result.ticks,
      result,
    });
    return null;
  }

  /** Called by the scene when the shot animation finished (or was skipped). */
  completeShot(): void {
    const p = this.pending;
    if (!p || this.disposed) return;
    this.pending = null;
    const { state, events } = applyShotResult(this.state, p.side, p.shot, p.result, this.rules);
    trackShot(this.stats, p.side, p.shot, p.result, events, this.shotPhysics(p.side).maxImpulse);
    this.state = state;
    this.publish(events);
    if (state.phase === 'ENDED') return;
    const scored = events.some((e) => e.type === 'goal');
    if (scored) {
      this.delayId = this.clock.setTimeout(() => {
        this.delayId = null;
        this.beginTurn();
      }, this.options.goalPauseMs ?? 1800);
      this.changed();
    } else {
      this.beginTurn();
    }
  }

  private publish(events: MatchEvent[]): void {
    trackEvents(this.stats, events);
    if (events.some((event) => event.type === 'ended')) this.endedAt ??= this.clock.now();
    this.lastEvents = events;
    const serial = (this.world.get(EventsTrait)?.serial ?? 0) + 1;
    this.world.set(EventsTrait, { events, serial });
    this.changed();
    this.bus.emit('events', events);
    const ended = events.find((e) => e.type === 'ended');
    if (ended) {
      this.stopTimer();
      this.bus.emit('ended', this.state);
    }
  }

  // ---- turns ----
  private beginTurn(): void {
    if (this.disposed || this.state.phase !== 'AWAIT_SHOT') return;
    if (this.pausedRemaining !== null) {
      this.resumeAction = () => this.beginTurn();
      return;
    }
    const turnTime = this.options.turnTimeMs === undefined ? this.rules.turnTimeMs : this.options.turnTimeMs;
    if (turnTime !== null)
      this.startTimer(
        this.options.mode === 'tutorial'
          ? turnTime
          : teamTurnTime(playerOf(this.state, this.state.turn.side).teamId, turnTime),
      );
    const ai = this.options.ai;
    if (ai && ai.side === this.state.turn.side) this.runAI(ai.side, ai.profile, ai.client);
    this.changed();
  }

  private runAI(side: Side, profile: AIProfile, client: AIClient): void {
    const token = ++this.aiToken;
    const startedAt = this.clock.now();
    const state = this.state;
    this.thinkingSide = side;
    client
      .decide(state, side, profile, state.rngSeed)
      .then((shot) => {
        // Decision latency: the bot "thinks" for at least its profile's time.
        const wait = Math.max(0, profile.thinkTimeMs - (this.clock.now() - startedAt));
        this.delayId = this.clock.setTimeout(() => {
          this.delayId = null;
          if (token !== this.aiToken || this.disposed || this.state !== state) return;
          if (this.pausedRemaining !== null) {
            this.resumeAction = () => this.finishAI(side, shot);
            return;
          }
          this.finishAI(side, shot);
        }, wait);
      })
      .catch(() => {
        // An AI failure must not hang the match: the turn timer will pass the turn.
        if (token === this.aiToken) this.thinkingSide = null;
        this.changed();
      });
  }

  private resumeAction: (() => void) | null = null;

  private finishAI(side: Side, shot: Shot): void {
    this.thinkingSide = null;
    this.submit(side, shot);
  }

  private startTimer(ms: number): void {
    this.stopTimer();
    this.turnEndsAt = this.clock.now() + ms;
    this.timerId = this.clock.setTimeout(() => this.onTimeout(), ms);
  }

  private stopTimer(): void {
    if (this.timerId !== null) this.clock.clearTimeout(this.timerId);
    this.timerId = null;
    this.turnEndsAt = null;
  }

  private onTimeout(): void {
    this.timerId = null;
    if (this.state.phase !== 'AWAIT_SHOT') return;
    this.aiToken++; // discard a late AI decision
    this.thinkingSide = null;
    const { state, events } = applyTimeout(this.state);
    this.state = state;
    this.publish(events);
    if (state.phase !== 'ENDED') this.beginTurn();
  }

  // ---- pause / forfeit ----
  pause(): void {
    if (this.pausedRemaining !== null || this.state.phase === 'ENDED') return;
    this.pausedRemaining = this.turnEndsAt !== null ? Math.max(0, this.turnEndsAt - this.clock.now()) : -1;
    this.stopTimer();
    this.changed();
  }

  resume(): void {
    if (this.pausedRemaining === null) return;
    const remaining = this.pausedRemaining;
    this.pausedRemaining = null;
    if (remaining >= 0 && this.state.phase === 'AWAIT_SHOT') this.startTimer(Math.max(remaining, 1000));
    const action = this.resumeAction;
    this.resumeAction = null;
    action?.();
    this.changed();
  }

  forfeit(side: Side): void {
    const { state, events } = forfeit(this.state, side, 'forfeit_quit');
    this.state = state;
    this.aiToken++;
    this.pending = null;
    this.publish(events);
  }

  playerOf(side: Side): PlayerInfo {
    return playerOf(this.state, side);
  }

  dispose(): void {
    this.disposed = true;
    this.aiToken++;
    this.stopTimer();
    if (this.delayId !== null) this.clock.clearTimeout(this.delayId);
    this.bus.clear();
    this.listeners.clear();
    this.options.ai?.client.dispose();
    this.world.destroy();
  }
}
