import { expect, it } from 'vitest';
import { createLocalFriendServer } from '../src/dev/localFriendServer';

const host = '11111111-1111-4111-8111-111111111111';
const guest = '22222222-2222-4222-8222-222222222222';
const stranger = '33333333-3333-4333-8333-333333333333';

it('creates one private match, validates participants, and rejects reuse and wrong-turn shots', async () => {
  const server = await createLocalFriendServer();
  const invite = server.handle('create', host, {});
  expect(invite.local).toBe(true);
  expect(() => server.handle('join', host, invite)).toThrow('selfJoin');
  expect(() => server.handle('status', stranger, invite)).toThrow('unauthorized');
  const joined = server.handle('join', guest, invite);
  expect(server.handle('join', guest, invite).matchId).toBe(joined.matchId);
  expect(() => server.handle('join', stranger, invite)).toThrow('used');
  const body = { matchId: joined.matchId };
  server.handle('connect', host, body);
  server.handle('connect', guest, body);
  const events = server.handle('events', host, body).events as {
    op: number;
    data: { you: string; state: { turn: { side: string; seq: number }; discsPerTeam: number } };
  }[];
  const state = events[0]!.data.state;
  expect(events[0]!.data.you).toBe('L');
  expect(() => server.handle('events', stranger, body)).toThrow('unavailable');
  const wrong = state.turn.side === 'L' ? guest : host;
  server.handle('command', wrong, {
    ...body,
    op: 1,
    data: JSON.stringify({ seq: state.turn.seq, discIndex: 0, ix: 0, iy: 1 }),
  });
  expect((server.handle('events', wrong, body).events as { op: number }[]).some((event) => event.op === 5)).toBe(true);
  server.handle('command', host, { ...body, op: 6 });
  expect((server.handle('events', guest, body).events as { op: number }[]).some((event) => event.op === 4)).toBe(true);
});

it('cancels invitations and rejects expired or invalid identities', async () => {
  const server = await createLocalFriendServer();
  const invite = server.handle('create', host, {});
  expect(() => server.handle('cancel', stranger, invite)).toThrow('unauthorized');
  server.handle('cancel', host, invite);
  expect(() => server.handle('join', guest, invite)).toThrow('expired');
  expect(() => server.handle('create', 'anonymous', {})).toThrow('unauthorized');
});
