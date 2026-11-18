import { useSyncExternalStore } from 'react';
import type { GamePlayer, GameReportReason, GameRoomState } from '@comms/sdk/game';

export type VoiceStatus = 'idle' | 'off' | 'unavailable' | 'connecting' | 'ready' | 'ended' | 'removed';
export type MicState = 'off' | 'pending' | 'on' | 'denied' | 'blocked';
export type ReportReason = GameReportReason;
export const REPORT_REASONS: readonly ReportReason[] = ['spam', 'abuse', 'cheating', 'other'];

export interface VoicePeer {
  id: string;
  name: string;
  connected: boolean;
  speaking: boolean;
  microphone: boolean;
  silenced: boolean;
  mutedByServer: boolean;
}

export interface VoiceState {
  status: VoiceStatus;
  mic: MicState;
  me: VoicePeer | null;
  peers: VoicePeer[];
  reported: string[];
  audioBlocked: boolean;
}

export interface VoiceRoom {
  join(token: string): Promise<void>;
  leave(): Promise<void>;
  setMic(on: boolean): Promise<void>;
  silence(playerId: string, on: boolean): void;
  report(playerId: string, reason: ReportReason, note?: string): Promise<unknown>;
  subscribe(listener: () => void): () => void;
  getSnapshot(): GameRoomState;
  resumeAudio?(): Promise<boolean>;
}

export interface VoiceDeps {
  enabled: () => boolean;
  baseUrl: string;
  mint: (matchId: string) => Promise<{ enabled: boolean; token?: string }>;
  openRoom: (baseUrl: string) => Promise<VoiceRoom>;
}

export type VoiceNotice = 'removed' | 'mutedByServer' | 'micDenied' | 'reportSent' | 'reportFailed';

const initial: VoiceState = { status: 'idle', mic: 'off', me: null, peers: [], reported: [], audioBlocked: false };

const peerOf = (p: GamePlayer): VoicePeer => ({
  id: p.id,
  name: p.name,
  connected: p.connected,
  speaking: p.connected && p.speaking,
  microphone: p.microphone,
  silenced: p.silenced,
  mutedByServer: p.mutedByServer,
});

const deniedError = (error: unknown): boolean => {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  return name === 'NotAllowedError' || name === 'SecurityError' || /permission|denied|not allowed/i.test(message);
};

export class VoiceSession {
  private state: VoiceState = initial;
  private listeners = new Set<() => void>();
  private noticeListeners = new Set<(notice: VoiceNotice) => void>();
  private room: VoiceRoom | null = null;
  private unsubscribeRoom: (() => void) | null = null;
  private matchId: string | null = null;
  private generation = 0;
  private rejoins = 0;

  constructor(private readonly deps: VoiceDeps) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): VoiceState => this.state;

  onNotice(listener: (notice: VoiceNotice) => void): () => void {
    this.noticeListeners.add(listener);
    return () => this.noticeListeners.delete(listener);
  }

  private set(patch: Partial<VoiceState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  private notify(notice: VoiceNotice): void {
    this.noticeListeners.forEach((l) => l(notice));
  }

  async start(matchId: string, rejoin = false): Promise<void> {
    if (this.matchId === matchId && this.state.status !== 'idle') return;
    const previous = this.room;
    this.detach();
    const generation = ++this.generation;
    if (!rejoin) this.rejoins = 0;
    this.matchId = matchId;
    if (previous) await previous.leave().catch(() => undefined);
    if (generation !== this.generation) return;
    if (!this.deps.enabled()) return this.set({ ...initial, status: 'off' });
    if (!this.deps.baseUrl) return this.set({ ...initial, status: 'unavailable' });
    this.set({ ...initial, status: 'connecting' });
    try {
      const grant = await this.deps.mint(matchId);
      if (generation !== this.generation) return;
      if (!grant.enabled || !grant.token) return this.set({ status: 'unavailable' });
      const room = await this.deps.openRoom(this.deps.baseUrl);
      if (generation !== this.generation) return;
      this.room = room;
      this.unsubscribeRoom = room.subscribe(() => this.sync(room));
      await room.join(grant.token);
      if (generation !== this.generation) {
        await room.leave().catch(() => undefined);
        return;
      }
      this.sync(room);
    } catch {
      if (generation === this.generation) {
        this.detach();
        this.set({ status: 'unavailable', mic: 'off', audioBlocked: false });
      }
    }
  }

  private sync(room: VoiceRoom): void {
    if (room !== this.room) return;
    const snap = room.getSnapshot();
    const players = snap.players.map(peerOf);
    const me = players.find((_, i) => snap.players[i]!.local) ?? null;
    const peers = players.filter((_, i) => !snap.players[i]!.local);
    let { status, mic } = this.state;
    if (snap.phase === 'joined') status = 'ready';
    if (snap.phase === 'closed') status = 'ended';
    if (snap.phase === 'left' && this.matchId) {
      this.detach();
      if (this.rejoins < 2) {
        this.rejoins++;
        const matchId = this.matchId;
        this.matchId = null;
        void this.start(matchId, true);
      } else {
        this.set({ status: 'ended', mic: 'off', audioBlocked: false });
      }
      return;
    }
    if (snap.phase === 'removed' && status !== 'removed') {
      status = 'removed';
      this.notify('removed');
    }
    const blocked = me?.mutedByServer ?? false;
    if (blocked && mic !== 'blocked') {
      mic = 'blocked';
      this.notify('mutedByServer');
    } else if (!blocked && mic === 'blocked') {
      mic = 'off';
    } else if (mic !== 'pending' && mic !== 'denied' && mic !== 'blocked') {
      mic = me?.microphone ? 'on' : 'off';
    }
    if (status === 'ended' || status === 'removed') mic = 'off';
    const audioBlocked = status === 'ready' && snap.audioBlocked;
    this.set({ status, mic, me, peers, audioBlocked });
    if (status === 'ended' || status === 'removed') this.detach();
  }

  async setMic(on: boolean): Promise<void> {
    const room = this.room;
    if (!room || this.state.status !== 'ready' || this.state.mic === 'blocked' || this.state.mic === 'pending') return;
    void this.resumeAudio();
    this.set({ mic: 'pending' });
    try {
      await room.setMic(on);
      this.set({ mic: on ? 'on' : 'off' });
    } catch (error) {
      if (this.room !== room) return;
      if (room.getSnapshot().me?.mutedByServer) {
        this.set({ mic: 'blocked' });
        return;
      }
      const denied = on && deniedError(error);
      this.set({ mic: denied ? 'denied' : 'off' });
      if (denied) this.notify('micDenied');
    }
  }

  async resumeAudio(): Promise<boolean> {
    const room = this.room;
    if (!room?.resumeAudio) return true;
    return room.resumeAudio().catch(() => false);
  }

  toggleMic(): Promise<void> {
    return this.setMic(this.state.mic !== 'on');
  }

  silence(playerId: string, on: boolean): void {
    this.room?.silence(playerId, on);
    if (this.room) this.sync(this.room);
  }

  async report(playerId: string, reason: ReportReason): Promise<boolean> {
    const room = this.room;
    if (!room || this.state.reported.includes(playerId)) return false;
    try {
      await room.report(playerId, reason);
      this.set({ reported: [...this.state.reported, playerId] });
      this.notify('reportSent');
      return true;
    } catch {
      this.notify('reportFailed');
      return false;
    }
  }

  private detach(): void {
    this.unsubscribeRoom?.();
    this.unsubscribeRoom = null;
    this.room = null;
  }

  async stop(): Promise<void> {
    this.generation++;
    const room = this.room;
    this.detach();
    this.matchId = null;
    if (this.state !== initial) this.set(initial);
    if (room) await room.leave().catch(() => undefined);
  }

  peer(id: string): VoicePeer | null {
    return this.state.peers.find((p) => p.id === id) ?? (this.state.me?.id === id ? this.state.me : null);
  }
}

export function useVoice(session: VoiceSession): VoiceState {
  return useSyncExternalStore(session.subscribe, session.getSnapshot);
}
