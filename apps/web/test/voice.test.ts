import { describe, expect, it, vi } from 'vitest';
import type { GamePlayer, GameRoomState } from '@comms/sdk/game';
import { VoiceSession, type VoiceDeps, type VoiceNotice, type VoiceRoom } from '../src/services/voice';

const player = (id: string, extra: Partial<GamePlayer> = {}): GamePlayer => ({
  id,
  name: id.toUpperCase(),
  identity: `p_${id}`,
  connected: true,
  speaking: false,
  microphone: false,
  camera: false,
  mutedByServer: false,
  silenced: false,
  local: false,
  ...extra,
});

class FakeRoom implements VoiceRoom {
  state: GameRoomState = { phase: 'idle', room: null, me: null, players: [], error: null, audioBlocked: false };
  listeners = new Set<() => void>();
  joined: string[] = [];
  left = 0;
  micCalls: boolean[] = [];
  micError: Error | null = null;
  reports: { id: string; reason: string }[] = [];
  reportError = false;
  silenced: [string, boolean][] = [];
  unlocked = 0;
  unlocks = true;

  emit(patch: Partial<GameRoomState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }
  players(me: Partial<GamePlayer> = {}, them: Partial<GamePlayer> = {}) {
    const mine = player('me', { local: true, ...me });
    this.emit({ players: [mine, player('them', them)], me: mine });
  }
  async join(token: string) {
    this.joined.push(token);
    this.emit({ phase: 'joining' });
    this.players();
    this.emit({ phase: 'joined' });
  }
  async leave() {
    this.left++;
    this.emit({ phase: 'left' });
  }
  async setMic(on: boolean) {
    this.micCalls.push(on);
    if (this.micError) throw this.micError;
    this.players({ microphone: on });
  }
  silence(id: string, on: boolean) {
    this.silenced.push([id, on]);
    this.players({}, { silenced: on });
  }
  async report(id: string, reason: string) {
    if (this.reportError) throw new Error('rate limited');
    this.reports.push({ id, reason });
    return {};
  }
  subscribe(l: () => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  getSnapshot() {
    return this.state;
  }
  async resumeAudio() {
    this.unlocked++;
    if (this.unlocks) this.emit({ audioBlocked: false });
    return this.unlocks;
  }
}

function setup(overrides: Partial<VoiceDeps> = {}) {
  const rooms: FakeRoom[] = [];
  const mint = vi.fn(async (matchId: string) => ({ enabled: true, token: `tok-${matchId}-${mint.mock.calls.length}` }));
  const openRoom = vi.fn(async () => {
    const r = new FakeRoom();
    rooms.push(r);
    return r;
  });
  const session = new VoiceSession({
    enabled: () => true,
    baseUrl: 'https://comms.test',
    mint,
    openRoom,
    ...overrides,
  });
  const notices: VoiceNotice[] = [];
  session.onNotice((n) => notices.push(n));
  return { session, rooms, mint, openRoom, notices };
}

describe('voice session', () => {
  it('joins with a minted token and starts with the microphone off', async () => {
    const { session, rooms, mint } = setup();
    await session.start('m1');
    expect(mint).toHaveBeenCalledWith('m1');
    expect(rooms[0]!.joined).toEqual(['tok-m1-1']);
    const s = session.getSnapshot();
    expect(s.status).toBe('ready');
    expect(s.mic).toBe('off');
    expect(s.me?.id).toBe('me');
    expect(s.peers.map((p) => p.id)).toEqual(['them']);
    expect(rooms[0]!.micCalls).toEqual([]);
  });

  it('stays quiet when voice is off, not configured or the server has no room', async () => {
    const off = setup({ enabled: () => false });
    await off.session.start('m1');
    expect(off.session.getSnapshot().status).toBe('off');
    expect(off.mint).not.toHaveBeenCalled();

    const noUrl = setup({ baseUrl: '' });
    await noUrl.session.start('m1');
    expect(noUrl.session.getSnapshot().status).toBe('unavailable');
    expect(noUrl.mint).not.toHaveBeenCalled();

    const noRoom = setup({ mint: async () => ({ enabled: false }) });
    await noRoom.session.start('m1');
    expect(noRoom.session.getSnapshot().status).toBe('unavailable');
    expect(noRoom.openRoom).not.toHaveBeenCalled();

    const broken = setup({ mint: async () => Promise.reject(new Error('rpc down')) });
    await broken.session.start('m1');
    expect(broken.session.getSnapshot().status).toBe('unavailable');
    expect(broken.notices).toEqual([]);
  });

  it('asks for the microphone only when the player turns it on', async () => {
    const { session, rooms } = setup();
    await session.start('m1');
    await session.toggleMic();
    expect(rooms[0]!.micCalls).toEqual([true]);
    expect(rooms[0]!.unlocked).toBe(1);
    expect(session.getSnapshot().mic).toBe('on');
    await session.toggleMic();
    expect(rooms[0]!.micCalls).toEqual([true, false]);
    expect(session.getSnapshot().mic).toBe('off');
  });

  it('reports a blocked microphone permission', async () => {
    const { session, rooms, notices } = setup();
    await session.start('m1');
    const denied = new Error('Permission denied');
    denied.name = 'NotAllowedError';
    rooms[0]!.micError = denied;
    await session.setMic(true);
    expect(session.getSnapshot().mic).toBe('denied');
    expect(notices).toEqual(['micDenied']);
    rooms[0]!.micError = null;
    await session.setMic(true);
    expect(session.getSnapshot().mic).toBe('on');
  });

  it('follows a mute by the game and refuses to unmute', async () => {
    const { session, rooms, notices } = setup();
    await session.start('m1');
    await session.setMic(true);
    rooms[0]!.players({ mutedByServer: true, microphone: false });
    expect(session.getSnapshot().mic).toBe('blocked');
    expect(notices).toContain('mutedByServer');
    await session.setMic(true);
    expect(rooms[0]!.micCalls).toEqual([true]);
    rooms[0]!.players({ mutedByServer: false });
    expect(session.getSnapshot().mic).toBe('off');
  });

  it('shows who is speaking and silences the opponent locally', async () => {
    const { session, rooms } = setup();
    await session.start('m1');
    rooms[0]!.players({}, { speaking: true, microphone: true });
    expect(session.peer('them')?.speaking).toBe(true);
    session.silence('them', true);
    expect(rooms[0]!.silenced).toEqual([['them', true]]);
    expect(session.peer('them')?.silenced).toBe(true);
  });

  it('sends one report per opponent', async () => {
    const { session, rooms, notices } = setup();
    await session.start('m1');
    rooms[0]!.reportError = true;
    expect(await session.report('them', 'abuse')).toBe(false);
    expect(notices).toEqual(['reportFailed']);
    rooms[0]!.reportError = false;
    expect(await session.report('them', 'abuse')).toBe(true);
    expect(await session.report('them', 'spam')).toBe(false);
    expect(rooms[0]!.reports).toEqual([{ id: 'them', reason: 'abuse' }]);
    expect(session.getSnapshot().reported).toEqual(['them']);
  });

  it('ends when the room closes and tells a removed player', async () => {
    const closed = setup();
    await closed.session.start('m1');
    closed.rooms[0]!.emit({ phase: 'closed' });
    expect(closed.session.getSnapshot().status).toBe('ended');

    const removed = setup();
    await removed.session.start('m1');
    removed.rooms[0]!.emit({ phase: 'removed' });
    expect(removed.session.getSnapshot().status).toBe('removed');
    expect(removed.notices).toEqual(['removed']);
  });

  it('rejoins with a fresh token after the media connection drops', async () => {
    const { session, rooms, mint } = setup();
    await session.start('m1');
    rooms[0]!.emit({ phase: 'left', error: 'disconnected' });
    await vi.waitFor(() => expect(session.getSnapshot().status).toBe('ready'));
    expect(mint).toHaveBeenCalledTimes(2);
    expect(rooms[1]!.joined).toEqual(['tok-m1-2']);
  });

  it('leaves on stop and ignores a join that finishes after stop', async () => {
    const { session, rooms } = setup();
    await session.start('m1');
    await session.stop();
    expect(rooms[0]!.left).toBe(1);
    expect(session.getSnapshot().status).toBe('idle');

    let release: (v: { enabled: boolean; token: string }) => void = () => undefined;
    const slow = setup({ mint: () => new Promise((r) => (release = r)) });
    const pending = slow.session.start('m2');
    await slow.session.stop();
    release({ enabled: true, token: 't' });
    await pending;
    expect(slow.openRoom).not.toHaveBeenCalled();
    expect(slow.session.getSnapshot().status).toBe('idle');
  });

  it('shows blocked playback and resumes it from a tap', async () => {
    const { session, rooms } = setup();
    expect(await session.resumeAudio()).toBe(true);
    await session.start('m1');
    const room = rooms[0]!;
    expect(session.getSnapshot().audioBlocked).toBe(false);
    room.emit({ audioBlocked: true });
    expect(session.getSnapshot().audioBlocked).toBe(true);
    room.unlocks = false;
    expect(await session.resumeAudio()).toBe(false);
    expect(session.getSnapshot().audioBlocked).toBe(true);
    room.unlocks = true;
    expect(await session.resumeAudio()).toBe(true);
    expect(session.getSnapshot().audioBlocked).toBe(false);
    expect(room.unlocked).toBe(2);
  });

  it('clears blocked playback when voice ends', async () => {
    const { session, rooms } = setup();
    await session.start('m1');
    rooms[0]!.emit({ audioBlocked: true });
    rooms[0]!.emit({ phase: 'closed' });
    expect(session.getSnapshot().status).toBe('ended');
    expect(session.getSnapshot().audioBlocked).toBe(false);
    await session.stop();
    expect(session.getSnapshot().audioBlocked).toBe(false);
  });
});
