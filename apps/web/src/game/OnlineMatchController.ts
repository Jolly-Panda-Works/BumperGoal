// Server-authoritative match driver (protocol v1, server/nakama/match.go).
//
// The server validates and simulates every shot. This client:
//  - predicts its own shot with the same Rapier wasm for instant feedback,
//  - replays the opponent's / bot's shot locally from the identical pre-state,
//  - adopts the server state after every playback (the server always wins;
//    a hash mismatch is reported and corrected, never trusted).
import type { MatchStatistics } from './matchStatistics';
import type { World } from 'koota';
import { physicsConfig, teamPhysics } from '@flickkick/config';
import {
  beginShot,
  impulseFromAim,
  otherSide,
  playerOf,
  validateShot,
  type MatchEvent,
  type MatchState,
  type PlayerInfo,
  type Shot,
  type ShotRejection,
  type Side,
} from '@flickkick/rules';
import { hashBodies, type FlickSim, type ShotResult } from '@flickkick/sim';
import { getSocket, onSocket, type MatchMessage } from '../services/online';
import type { MatchDriver } from './driver';
import { createMatchWorld } from './ecs/systems';
import { EventsTrait, HudTrait, MatchTrait, PlaybackTrait } from './ecs/traits';
import { Emitter } from './emitter';
import type { ControllerEvents } from './MatchController';

/** Live controllers per match id (see dispose). */
const active = new Map<string, Set<OnlineMatchController>>();

export const OP = { shot: 1, resolved: 2, sync: 3, ended: 4, reject: 5, forfeit: 6 } as const;

export interface OnlineRewards {
  xp: number;
  coins: number;
  gems: number;
  prize: number;
  entryFee: number;
  levelBefore: number;
  levelAfter: number;
}

interface ResolvedPayload {
  resolved: { side: Side; shot: Shot; preHash: string; outcome: string; ticks: number; hash: string } | null;
  events: MatchEvent[];
  state: MatchState;
  turnMs: number;
  turnStartMs: number;
}

interface Pending {
  side: Side;
  shot: Shot;
  local: ShotResult;
  server: (ResolvedPayload & { receivedAt: number }) | null;
  playbackDone: boolean;
}

export type OnlineOnlyEvents = {
  aborted: string;
  mismatch: { local: string; server: string };
};

export interface MatchTransport {
  onData(listener: (message: MatchMessage) => void): () => void;
  onDisconnected(listener: () => void): () => void;
  onReconnected(listener: () => void): () => void;
  socket(): Promise<{
    joinMatch(id: string): Promise<unknown>;
    leaveMatch(id: string): Promise<unknown>;
    sendMatchState(id: string, op: number, data: string): Promise<unknown>;
  }>;
}
const nakamaTransport: MatchTransport = {
  onData: (listener) => onSocket('matchData', listener),
  onDisconnected: (listener) => onSocket('disconnected', listener),
  onReconnected: (listener) => onSocket('reconnected', listener),
  socket: getSocket,
};

export class OnlineMatchController implements MatchDriver {
  readonly online = true;
  trailIds: Partial<Record<Side, string>> = {};
  readonly bus = new Emitter<ControllerEvents>();
  /** Online-only signals (aborted before start, client/server divergence). */
  readonly signals = new Emitter<OnlineOnlyEvents>();
  world!: World;
  private state!: MatchState;
  private mySide: Side = 'L';
  private pending: Pending | null = null;
  private queue: MatchMessage[] = [];
  private turnEndsAt: number | null = null;
  private turnOpensAt = 0;
  private reconnecting = false;
  private ended = false;
  private disposed = false;
  private rewards: OnlineRewards | null = null;
  private finalStatistics: MatchStatistics | undefined;
  get statistics() {
    return this.finalStatistics;
  }
  private unsubscribe: (() => void)[] = [];

  constructor(
    readonly matchId: string,
    readonly sim: FlickSim,
    private readonly transport: MatchTransport = nakamaTransport,
  ) {
    let set = active.get(matchId);
    if (!set) active.set(matchId, (set = new Set()));
    set.add(this);
  }

  /** Joins the match and resolves with the first authoritative state. */
  async join(timeoutMs = 10_000): Promise<void> {
    const first = new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('join timed out')), timeoutMs);
      this.unsubscribe.push(
        this.transport.onData((m) => {
          if (m.matchId !== this.matchId || this.disposed) return;
          if (!this.world && m.op === OP.sync) {
            window.clearTimeout(timer);
            this.applySync(m.data);
            resolve();
            return;
          }
          if (!this.world && m.op === OP.ended && m.data.aborted) {
            window.clearTimeout(timer);
            reject(new Error(String(m.data.reason ?? 'aborted')));
            return;
          }
          if (this.world) this.receive(m);
        }),
        this.transport.onDisconnected(() => this.setReconnecting(true)),
        this.transport.onReconnected(() => void this.rejoin()),
      );
    });
    const socket = await this.transport.socket();
    await socket.joinMatch(this.matchId);
    await first;
  }

  private async rejoin(): Promise<void> {
    if (this.ended || this.disposed) return;
    try {
      const socket = await this.transport.socket();
      await socket.joinMatch(this.matchId); // the server answers with a state sync
    } catch {
      // the online service keeps retrying the socket
    }
  }

  private setReconnecting(on: boolean): void {
    this.reconnecting = on;
    this.publishHud();
  }

  // ---------- MatchDriver ----------
  get current(): MatchState {
    return this.state;
  }

  isHuman(side: Side): boolean {
    return side === this.mySide;
  }

  playerOf(side: Side): PlayerInfo {
    return playerOf(this.state, side);
  }

  canAim(): boolean {
    return (
      !this.disposed &&
      !this.ended &&
      !this.reconnecting &&
      !this.pending &&
      this.state.phase === 'AWAIT_SHOT' &&
      this.state.turn.side === this.mySide &&
      performance.now() >= this.turnOpensAt
    );
  }

  start(): void {
    this.publishHud();
  }

  pause(): void {
    // Online matches cannot be paused; the turn timer keeps running.
  }

  resume(): void {}

  requestShot(discIndex: number, angle: number, power: number): ShotRejection | null {
    if (!this.canAim()) return 'not_awaiting_shot';
    const physics = teamPhysics(playerOf(this.state, this.mySide).teamId, physicsConfig);
    const shot: Shot = { seq: this.state.turn.seq, discIndex, ...impulseFromAim(angle, power, physics) };
    const check = validateShot(this.state, this.mySide, shot, physics);
    if (!check.ok) {
      this.bus.emit('rejected', check.reason);
      return check.reason;
    }
    void this.transport.socket().then((s) => s.sendMatchState(this.matchId, OP.shot, JSON.stringify(shot)));
    // Prediction: animate immediately with the same wasm the server runs.
    this.startPlayback(this.mySide, shot, null);
    return null;
  }

  forfeit(): void {
    void this.transport.socket().then((s) => s.sendMatchState(this.matchId, OP.forfeit, '{}'));
  }

  completeShot(): void {
    const p = this.pending;
    if (!p) return;
    p.playbackDone = true;
    if (p.server) this.adoptServerResult(p.server);
    // else: wait for the server's resolution (it arrives within a tick or two).
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe.forEach((u) => u());
    active.get(this.matchId)?.delete(this);
    // Leave only if no other controller took over this match (a React StrictMode
    // remount shares the socket; an early leave would drop its presence).
    const matchId = this.matchId;
    if (!this.ended) {
      window.setTimeout(() => {
        if ((active.get(matchId)?.size ?? 0) > 0) return;
        void this.transport
          .socket()
          .then((s) => s.leaveMatch(matchId))
          .catch(() => undefined);
      }, 500);
    }
    this.bus.clear();
    this.signals.clear();
    this.world?.destroy();
  }

  get finalRewards(): OnlineRewards | null {
    return this.rewards;
  }

  get side(): Side {
    return this.mySide;
  }

  // ---------- protocol ----------
  private receive(m: MatchMessage): void {
    if (this.pending && m.op !== OP.resolved && m.op !== OP.reject) {
      this.queue.push(m); // keep order: apply after the current playback
      return;
    }
    switch (m.op) {
      case OP.sync:
        this.applySync(m.data);
        break;
      case OP.resolved:
        this.onResolved(m.data as unknown as ResolvedPayload);
        break;
      case OP.reject:
        this.onReject();
        break;
      case OP.ended:
        this.onEnded(m.data);
        break;
    }
  }

  private drainQueue(): void {
    while (!this.pending && this.queue.length > 0) this.receive(this.queue.shift()!);
  }

  private applySync(data: Record<string, unknown>): void {
    const state = data.state as MatchState;
    this.mySide = data.you as Side;
    this.trailIds = (data.trailIds ?? {}) as Partial<Record<Side, string>>;
    this.state = state;
    if (!this.world) this.world = createMatchWorld(state);
    this.world.set(PlaybackTrait, { ...this.world.get(PlaybackTrait)!, active: false });
    this.pending = null;
    this.reconnecting = false;
    this.turnOpensAt = performance.now();
    this.turnEndsAt = state.phase === 'AWAIT_SHOT' ? performance.now() + Number(data.turnMs ?? 0) : null;
    this.publishState();
  }

  private onResolved(p: ResolvedPayload): void {
    const receivedAt = performance.now();
    if (!p.resolved) {
      // Timeouts / forfeits: no physics to play.
      this.applyAuthoritative(p, receivedAt);
      return;
    }
    const mine = this.pending && this.pending.side === p.resolved.side && this.pending.shot.seq === p.resolved.shot.seq;
    if (mine) {
      this.pending!.server = { ...p, receivedAt };
      if (this.pending!.playbackDone) this.adoptServerResult(this.pending!.server);
      return;
    }
    if (this.pending) {
      this.queue.push({ matchId: this.matchId, op: OP.resolved, data: p as unknown as Record<string, unknown> });
      return;
    }
    // Opponent / bot shot: replay locally from the same pre-state, then adopt.
    if (hashBodies(this.state.bodies) !== p.resolved.preHash) {
      this.applyAuthoritative(p, receivedAt); // out of sync: skip the animation, take the server state
      return;
    }
    this.startPlayback(p.resolved.side, p.resolved.shot, { ...p, receivedAt });
  }

  private startPlayback(side: Side, shot: Shot, server: Pending['server']): void {
    const local = this.sim.simulateShot(
      this.state.bodies,
      { bodyIndex: shot.discIndex, ix: shot.ix, iy: shot.iy },
      { recordFrames: true },
    );
    this.pending = { side, shot, local, server, playbackDone: false };
    this.state = beginShot(this.state);
    this.world.set(PlaybackTrait, {
      active: true,
      side,
      shot,
      frames: local.frames!,
      bodyCount: this.state.bodies.length,
      ticks: local.ticks,
      elapsedMs: 0,
      lastFrame: 0,
    });
    this.publishState();
    this.bus.emit('playShot', {
      side,
      shot,
      frames: local.frames!,
      bodyCount: this.state.bodies.length,
      ticks: local.ticks,
      result: local,
    });
  }

  private adoptServerResult(server: ResolvedPayload & { receivedAt: number }): void {
    const local = this.pending?.local;
    if (local && server.resolved && local.hash !== server.resolved.hash) {
      console.warn(
        'Bumper Goal: client/server simulation mismatch, adopting server state',
        local.hash,
        server.resolved.hash,
      );
      this.signals.emit('mismatch', { local: local.hash, server: server.resolved.hash });
    }
    this.pending = null;
    this.applyAuthoritative(server, server.receivedAt);
    this.drainQueue();
  }

  private applyAuthoritative(p: ResolvedPayload, receivedAt: number): void {
    this.state = p.state;
    // The server opens the next turn after everyone's playback; mirror that window.
    // receivedAt is already later than the server's send time, so this never opens early.
    this.turnOpensAt = receivedAt + p.turnStartMs + 50;
    this.turnEndsAt = p.state.phase === 'AWAIT_SHOT' ? receivedAt + p.turnMs : null;
    this.world.set(EventsTrait, { events: p.events, serial: (this.world.get(EventsTrait)?.serial ?? 0) + 1 });
    this.publishState();
    this.bus.emit('events', p.events);
    // Re-check aim permission when the playback window closes.
    const wait = this.turnOpensAt - performance.now();
    if (wait > 0) window.setTimeout(() => this.publishHud(), wait + 10);
  }

  private onReject(): void {
    // The server follows a rejection with a state sync; drop the local prediction.
    if (this.pending && !this.pending.server) {
      this.pending = null;
      this.world.set(PlaybackTrait, { ...this.world.get(PlaybackTrait)!, active: false });
    }
  }

  private onEnded(data: Record<string, unknown>): void {
    if (data.aborted) {
      this.ended = true;
      this.signals.emit('aborted', String(data.reason ?? 'aborted'));
      return;
    }
    this.ended = true;
    this.finalStatistics = data.statistics as MatchStatistics | undefined;
    this.rewards = (data.rewards as OnlineRewards | undefined) ?? null;
    if (data.state) this.state = data.state as MatchState;
    this.publishState();
    this.bus.emit('ended', this.state);
  }

  // ---------- ECS ----------
  private publishState(): void {
    if (this.disposed || !this.world) return;
    this.world.set(MatchTrait, { state: this.state });
    this.publishHud();
  }

  private publishHud(): void {
    if (this.disposed || !this.world) return;
    const opp = otherSide(this.mySide);
    const botThinking =
      this.state.phase === 'AWAIT_SHOT' && this.state.turn.side === opp && this.playerOf(opp).isBot && !this.pending;
    this.world.set(HudTrait, {
      thinkingSide: botThinking ? opp : null,
      turnEndsAt: this.turnEndsAt,
      paused: false,
      canAim: this.canAim(),
      reconnecting: this.reconnecting,
    });
  }
}
