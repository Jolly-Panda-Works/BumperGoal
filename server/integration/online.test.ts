// Real integration tests against the local Nakama stack (pnpm server:up).
// Skipped, not faked, when the server is not reachable.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, type Session, type Socket } from '@heroiclabs/nakama-js';

const HOST = process.env.NAKAMA_HOST ?? '127.0.0.1';
const PORT = process.env.NAKAMA_PORT ?? '7350';
const envFile = fileURLToPath(new URL('../deploy/.env', import.meta.url));
const SERVER_KEY =
  process.env.NAKAMA_SERVER_KEY ??
  (() => {
    try {
      return /^NAKAMA_SERVER_KEY=(.*)$/m.exec(readFileSync(envFile, 'utf8'))?.[1]?.trim() ?? '';
    } catch {
      return '';
    }
  })();

const OP = { shot: 1, resolved: 2, sync: 3, ended: 4, reject: 5, forfeit: 6 } as const;
const BOT_TIMEOUT_MS = Number(process.env.MM_BOT_TIMEOUT_MS ?? 15000);

let up = false;
beforeAll(async () => {
  up = await fetch(`http://${HOST}:${PORT}/healthcheck`)
    .then((r) => r.ok)
    .catch(() => false);
});

interface Msg {
  op: number;
  data: Record<string, unknown>;
}

class Player {
  readonly client = new Client(SERVER_KEY, HOST, PORT, false, 7000);
  session!: Session;
  socket!: Socket;
  messages: Msg[] = [];
  notifications: { code: number; content: Record<string, unknown>; at: number }[] = [];
  matched: { matchId: string; at: number } | null = null;

  async connect(name: string) {
    this.session = await this.client.authenticateDevice(`it-${name}-${crypto.randomUUID()}`, true);
    this.socket = this.client.createSocket(false, false);
    this.socket.onmatchdata = (m) =>
      this.messages.push({ op: m.op_code, data: JSON.parse(new TextDecoder().decode(m.data)) });
    this.socket.onnotification = (n) =>
      this.notifications.push({ code: n.code!, content: n.content as Record<string, unknown>, at: Date.now() });
    this.socket.onmatchmakermatched = (m) => {
      this.matched = { matchId: m.match_id!, at: Date.now() };
    };
    await this.socket.connect(this.session, true);
    return this;
  }

  rpc<T>(id: string, input: object = {}) {
    return this.client.rpc(this.session, id, input).then((r) => r.payload as T);
  }

  async wallet() {
    return (await this.rpc<{ wallet: { coins: number; gems: number } }>('profile_get')).wallet;
  }

  async search(arena = 'park') {
    const s = await this.rpc<{ searchId: string; query: string; props: Record<string, string> }>('mm_start', { arena });
    const ticket = await this.socket.addMatchmaker(s.query, 2, 2, s.props);
    return { ...s, ticket: ticket.ticket };
  }

  async waitFor<T>(fn: () => T | null | undefined | false, ms: number, label: string): Promise<T> {
    const end = Date.now() + ms;
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  lastOf(op: number) {
    return [...this.messages].reverse().find((m) => m.op === op);
  }

  send(matchId: string, op: number, payload: object) {
    return this.socket.sendMatchState(matchId, op, JSON.stringify(payload));
  }

  close() {
    this.socket?.disconnect(false);
  }
}

const players: Player[] = [];
const player = async (name: string) => {
  const p = await new Player().connect(name);
  players.push(p);
  return p;
};
afterAll(() => players.forEach((p) => p.close()));

type SyncState = {
  players: { id: string; isBot: boolean; side: string }[];
  turn: { side: string; seq: number };
  phase: string;
  bodies: { kind: string; x: number; y: number }[];
};

describe.runIf(process.env.CI_INTEGRATION !== '0')('Nakama integration', () => {
  it('two humans in the same arena are matched into one authoritative match', { timeout: 40_000 }, async (ctx) => {
    if (!up) ctx.skip();
    const a = await player('a');
    const b = await player('b');
    const before = await a.wallet();
    await a.search();
    await b.search();
    const ma = await a.waitFor(() => a.matched, 15_000, 'a matched');
    const mb = await b.waitFor(() => b.matched, 15_000, 'b matched');
    expect(ma.matchId).toBe(mb.matchId);

    await a.socket.joinMatch(ma.matchId);
    await b.socket.joinMatch(mb.matchId);
    const sa = await a.waitFor(() => a.lastOf(OP.sync), 5000, 'a sync');
    const state = sa.data.state as SyncState;
    expect(state.players.every((p) => !p.isBot)).toBe(true);
    expect(sa.data.you).toBe(state.players.find((p) => p.id === a.session.user_id)!.side);

    // Entry fee debited exactly once, at match start.
    expect((await a.wallet()).coins).toBe(before.coins - 50);

    // Out-of-turn shot is rejected; the player whose turn it is gets resolved.
    const [mover, other] = state.turn.side === sa.data.you ? [a, b] : [b, a];
    const moverSide = state.turn.side;
    const disc = moverSide === 'L' ? 1 : 6;
    await other.send(ma.matchId, OP.shot, { seq: state.turn.seq, discIndex: other === a ? 1 : 6, ix: 3, iy: 0 });
    const rej = await other.waitFor(() => other.lastOf(OP.reject), 5000, 'reject');
    expect(rej.data.reason).toBe('not_your_turn');
    // Forged impulse beyond the limit is rejected.
    await mover.send(ma.matchId, OP.shot, { seq: state.turn.seq, discIndex: disc, ix: 500, iy: 0 });
    await mover.waitFor(
      () => mover.messages.some((m) => m.op === OP.reject && m.data.reason === 'power_out_of_range'),
      5000,
      'range reject',
    );
    // Opponent's disc is rejected.
    await mover.send(ma.matchId, OP.shot, { seq: state.turn.seq, discIndex: moverSide === 'L' ? 6 : 1, ix: 3, iy: 0 });
    await mover.waitFor(() => mover.messages.some((m) => m.data.reason === 'not_your_disc'), 5000, 'disc reject');

    await mover.send(ma.matchId, OP.shot, {
      seq: state.turn.seq,
      discIndex: disc,
      ix: moverSide === 'L' ? 4 : -4,
      iy: 0.5,
    });
    const res = await a.waitFor(() => a.lastOf(OP.resolved), 5000, 'resolved');
    const resolved = res.data.resolved as { side: string; hash: string; ticks: number };
    expect(resolved.side).toBe(moverSide);
    expect((res.data.state as SyncState).turn.side).not.toBe(moverSide);
    // Replaying the same (now stale) shot is rejected.
    await mover.send(ma.matchId, OP.shot, { seq: state.turn.seq, discIndex: disc, ix: 4, iy: 0 });
    await mover.waitFor(() => mover.messages.filter((m) => m.op === OP.reject).length >= 3, 5000, 'replay reject');

    // Forfeit ends the match; the other player is credited the prize once.
    const otherBefore = await other.wallet();
    await mover.send(ma.matchId, OP.forfeit, {});
    const ended = await other.waitFor(() => other.lastOf(OP.ended), 5000, 'ended');
    expect(ended.data.recorded).toBe(true);
    const rewards = ended.data.rewards as {
      prize: number;
      xp: number;
      coins: number;
      levelBefore: number;
      levelAfter: number;
    };
    expect(rewards.prize).toBe(95); // 2 × 50 entry − 5% house cut
    expect(rewards.xp).toBe(100); // win, 0 goals, park multiplier 1.0
    expect(rewards).toMatchObject({ levelBefore: 1, levelAfter: 2 });
    expect(rewards.coins).toBe(95 + 200); // prize + level-2 reward (coinsPerLevel × 2)
    expect((await other.wallet()).coins).toBe(otherBefore.coins + rewards.coins);

    // No bot match is ever created for searches that were matched with a human.
    await new Promise((r) => setTimeout(r, Math.max(0, BOT_TIMEOUT_MS - (Date.now() - ma.at)) + 1500));
    expect(a.notifications.filter((n) => n.code === 101)).toHaveLength(0);
    expect(b.notifications.filter((n) => n.code === 101)).toHaveLength(0);

    const history = await other.rpc<{ entries: { matchId: string; opponentIsBot: boolean; won: boolean }[] }>(
      'history_list',
    );
    expect(history.entries[0]).toMatchObject({ matchId: ma.matchId, opponentIsBot: false, won: true });
  });

  it(
    'falls back to a bot after the server-measured timeout and labels it as a bot',
    { timeout: BOT_TIMEOUT_MS + 30_000 },
    async (ctx) => {
      if (!up) ctx.skip();
      const p = await player('solo');
      const started = Date.now();
      const s = await p.search('park');
      const note = await p.waitFor(
        () => p.notifications.find((n) => n.code === 101),
        BOT_TIMEOUT_MS + 6000,
        'bot notification',
      );
      expect(note.at - started).toBeGreaterThanOrEqual(BOT_TIMEOUT_MS - 200);
      expect(note.content).toMatchObject({ opponent: 'bot', searchId: s.searchId });
      expect(p.matched).toBeNull();
      await p.socket.removeMatchmaker(s.ticket).catch(() => undefined);

      const status = await p.rpc<{ state: string; opponent: string }>('mm_status', { searchId: s.searchId });
      expect(status).toMatchObject({ state: 'bot_assigned', opponent: 'bot' });

      await p.socket.joinMatch(note.content.matchId as string);
      const sync = await p.waitFor(() => p.lastOf(OP.sync), 5000, 'sync');
      const state = sync.data.state as SyncState;
      expect(state.players[1]!.isBot).toBe(true);
      expect(sync.data.you).toBe('L');

      // The bot plays its turns through the server's validation path.
      if (state.turn.side === 'L') {
        await p.send(note.content.matchId as string, OP.shot, { seq: state.turn.seq, discIndex: 1, ix: 4, iy: 0.4 });
      }
      await p.waitFor(
        () =>
          p.messages.some((m) => m.op === OP.resolved && (m.data.resolved as { side: string } | null)?.side === 'R'),
        20_000,
        'bot shot',
      );

      await p.send(note.content.matchId as string, OP.forfeit, {});
      const ended = await p.waitFor(() => p.lastOf(OP.ended), 5000, 'ended');
      expect(ended.data.recorded).toBe(true);
      const history = await p.rpc<{ entries: { opponentIsBot: boolean; won: boolean; reason: string }[] }>(
        'history_list',
      );
      expect(history.entries[0]).toMatchObject({ opponentIsBot: true, won: false, reason: 'forfeit_quit' });
    },
  );

  it('a cancelled search never produces a match or a charge', { timeout: BOT_TIMEOUT_MS + 15_000 }, async (ctx) => {
    if (!up) ctx.skip();
    const p = await player('cancel');
    const before = await p.wallet();
    const s = await p.search('park');
    const res = await p.rpc<{ cancelled: boolean }>('mm_cancel', { searchId: s.searchId });
    expect(res.cancelled).toBe(true);
    await p.socket.removeMatchmaker(s.ticket);
    await new Promise((r) => setTimeout(r, BOT_TIMEOUT_MS + 1500));
    expect(p.notifications).toHaveLength(0);
    expect(p.matched).toBeNull();
    expect(await p.wallet()).toEqual(before);
  });

  it('rejects searches the player is not eligible for', async (ctx) => {
    if (!up) ctx.skip();
    const p = await player('elig');
    await expect(p.rpc('mm_start', { arena: 'legends' })).rejects.toBeTruthy(); // level 16 arena
    await expect(p.rpc('mm_start', { arena: 'nope' })).rejects.toBeTruthy();
  });
});
