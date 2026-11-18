// Development-only authority, loaded by Vite on the Node server, never by the game client.
import { randomBytes } from 'node:crypto';
import { cosmetics, physicsConfig, rulesConfig, teamPhysics, teamTurnTime } from '@flickkick/config';
import {
  applyShotResult,
  applyTimeout,
  createMatch,
  forfeit,
  validateShot,
  type MatchState,
  type Shot,
  type Side,
  type MatchEvent,
} from '@flickkick/rules';
import { FlickSim } from '@flickkick/sim';
import { createMatchStatistics, trackEvents, trackShot, type MatchStatistics } from '../game/matchStatistics';

type Payload = Record<string, unknown>;
interface Player {
  token: string;
  name: string;
  teamId: string;
  avatarId: string;
  formationId: string;
  trailId: string;
}
interface Invitation {
  code: string;
  expiresAt: number;
  host: Player;
  guest?: Player;
  matchId?: string;
}
interface Event {
  serial: number;
  matchId: string;
  op: number;
  data: Payload;
}
interface Room {
  id: string;
  players: [Player, Player];
  state: MatchState;
  stats: MatchStatistics;
  rules: typeof rulesConfig;
  joined: Map<string, number>;
  events: Map<string, Event[]>;
  serial: number;
  created: number;
  started: number;
  opens: number;
  deadline: number;
}
const failure = (code: string): never => {
  throw new Error(code);
};

export async function createLocalFriendServer() {
  const sim = await FlickSim.create(physicsConfig);
  const invitations = new Map<string, Invitation>();
  const rooms = new Map<string, Room>();
  const attempts = new Map<string, number[]>();
  const player = (token: string, body: Payload): Player => {
    const profile = (body.profile ?? {}) as Payload;
    const item = (kind: 'teams' | 'avatars' | 'formations' | 'trails', key: string) =>
      cosmetics[kind].find((item) => item.id === profile[key])?.id ?? cosmetics[kind][0]?.id ?? '';
    return {
      token,
      name: String(profile.displayName ?? 'Player').slice(0, 16),
      teamId: item('teams', 'teamId'),
      avatarId: item('avatars', 'avatarId'),
      formationId: item('formations', 'formationId'),
      trailId: String(profile.trailId ?? '') ? item('trails', 'trailId') : '',
    };
  };
  const publicInvite = (invite: Invitation) => ({
    code: invite.code,
    expiresAt: invite.expiresAt,
    matchId: invite.matchId,
    local: true,
  });
  const send = (room: Room, op: number, data: Payload, token?: string) => {
    for (const target of token ? [token] : room.players.map((player) => player.token)) {
      const queue = room.events.get(target) ?? [];
      queue.push({ serial: ++room.serial, matchId: room.id, op, data });
      room.events.set(target, queue.slice(-128));
    }
  };
  const turnMs = (room: Room) =>
    teamTurnTime(room.state.players[room.state.turn.side === 'L' ? 0 : 1].teamId, rulesConfig.turnTimeMs);
  const sync = (room: Room, token: string) =>
    send(
      room,
      3,
      {
        state: room.state,
        you: room.players[0].token === token ? 'L' : 'R',
        turnMs: Math.max(0, room.deadline - Date.now()),
        trailIds: { L: room.players[0].trailId, R: room.players[1].trailId },
      },
      token,
    );
  const finish = (room: Room) => {
    room.stats.durationMs = Date.now() - room.started;
    send(room, 4, { state: room.state, statistics: room.stats });
  };
  const update = (room: Room, state: MatchState, events: MatchEvent[]) => {
    room.state = state;
    trackEvents(room.stats, events);
    room.opens = Date.now();
    room.deadline = room.opens + turnMs(room);
    if (state.phase === 'ENDED') finish(room);
    else for (const participant of room.players) sync(room, participant.token);
  };
  const tick = () => {
    const now = Date.now();
    for (const [code, invite] of invitations) if (invite.expiresAt * 1000 <= now) invitations.delete(code);
    for (const [token, list] of attempts) if (!list.length || list.at(-1)! < now - 60000) attempts.delete(token);
    for (const [id, room] of rooms) {
      if (now - room.created > 30 * 60000) {
        rooms.delete(id);
        continue;
      }
      if (!room.started || room.state.phase === 'ENDED') continue;
      const missing = room.players.find((player) => now - (room.joined.get(player.token) ?? room.started) > 30000);
      if (missing) {
        const result = forfeit(room.state, missing === room.players[0] ? 'L' : 'R', 'forfeit_disconnect');
        update(room, result.state, result.events);
      } else if (now >= room.deadline) {
        const result = applyTimeout(room.state);
        update(room, result.state, result.events);
      }
    }
  };
  return {
    tick,
    handle(action: string, token: string, body: Payload): Payload {
      if (!/^[a-zA-Z0-9-]{32,64}$/.test(token)) return failure('unauthorized');
      tick();
      const code = String(body.code ?? '')
        .trim()
        .toUpperCase();
      if (action === 'create') {
        for (const invite of invitations.values())
          if (invite.host.token === token && !invite.guest) return publicInvite(invite);
        if (invitations.size >= 1000) return failure('busy');
        const value = randomBytes(6).toString('hex').toUpperCase();
        const invite: Invitation = {
          code: value,
          host: player(token, body),
          expiresAt: Math.floor(Date.now() / 1000) + 600,
        };
        invitations.set(value, invite);
        return publicInvite(invite);
      }
      if (['join', 'status', 'cancel'].includes(action)) {
        const invite = invitations.get(code);
        if (action === 'join') {
          const recent = (attempts.get(token) ?? []).filter((at) => at > Date.now() - 60000);
          if (recent.length >= 20) return failure('rateLimited');
          attempts.set(token, [...recent, Date.now()]);
        }
        if (!invite) {
          if (action === 'cancel') return { cancelled: true };
          return failure('expired');
        }
        if (action === 'join') {
          if (invite.host.token === token) return failure('selfJoin');
          if (invite.guest) return invite.guest.token === token ? publicInvite(invite) : failure('used');
          if (rooms.size >= 200) return failure('busy');
          const guest = player(token, body);
          const formation = (id: string) =>
            cosmetics.formations.find((formation) => formation.id === id)?.positions ?? rulesConfig.formation;
          const rules = {
            ...rulesConfig,
            formation: formation(invite.host.formationId),
            opponentFormation: formation(guest.formationId),
          };
          const id = 'local-friend-' + randomBytes(8).toString('hex');
          const players: [Player, Player] = [invite.host, guest];
          const state = createMatch({
            matchId: id,
            mode: 'online',
            rngSeed: randomBytes(4).readUInt32LE(),
            rules,
            players: players.map((p) => ({
              id: p.token,
              displayName: p.name,
              teamId: p.teamId,
              level: 1,
              isBot: false,
            })) as Parameters<typeof createMatch>[0]['players'],
          });
          rooms.set(id, {
            id,
            players,
            state,
            stats: createMatchStatistics(),
            rules,
            joined: new Map(),
            events: new Map(),
            serial: 0,
            created: Date.now(),
            started: 0,
            opens: 0,
            deadline: 0,
          });
          invite.guest = guest;
          invite.matchId = id;
          return publicInvite(invite);
        }
        if (action === 'status') {
          if (invite.host.token !== token && invite.guest?.token !== token) return failure('unauthorized');
          return publicInvite(invite);
        }
        if (invite.host.token !== token) return failure('unauthorized');
        const room = rooms.get(invite.matchId ?? '');
        if (room?.started) return failure('started');
        if (room) {
          send(room, 4, { aborted: true, reason: 'cancelled' });
          rooms.delete(room.id);
        }
        invitations.delete(code);
        return { cancelled: true };
      }
      const room = rooms.get(String(body.matchId));
      if (!room || !room.players.some((player) => player.token === token)) return failure('unavailable');
      const side: Side = room.players[0].token === token ? 'L' : 'R';
      if (action === 'connect') {
        room.joined.set(token, Date.now());
        room.events.set(token, []);
        if (!room.started && room.players.every((player) => room.joined.has(player.token))) {
          room.started = Date.now();
          room.opens = room.started;
          room.deadline = room.opens + turnMs(room);
          for (const player of room.players) sync(room, player.token);
        } else if (room.started) sync(room, token);
        return { joined: true };
      }
      if (action === 'events') {
        room.joined.set(token, Date.now());
        return { events: (room.events.get(token) ?? []).filter((event) => event.serial > Number(body.after ?? 0)) };
      }
      if (action === 'disconnect') {
        room.joined.set(token, Date.now() - 30000);
        return {};
      }
      if (action !== 'command' || !room.started) return failure('unavailable');
      const op = Number(body.op);
      if (op === 6) {
        const result = forfeit(room.state, side, 'forfeit_quit');
        update(room, result.state, result.events);
        return {};
      }
      if (op !== 1 || Date.now() < room.opens) {
        send(room, 5, { reason: 'not_awaiting_shot' }, token);
        sync(room, token);
        return {};
      }
      const shot = JSON.parse(String(body.data)) as Shot;
      const physics = teamPhysics(room.state.players[side === 'L' ? 0 : 1].teamId, physicsConfig);
      const check = validateShot(room.state, side, shot, physics);
      if (!check.ok) {
        send(room, 5, { reason: check.reason }, token);
        sync(room, token);
        return {};
      }
      const preHash = room.state.stateHash;
      const result = sim.simulateShot(room.state.bodies, { bodyIndex: shot.discIndex, ix: shot.ix, iy: shot.iy });
      const resolved = applyShotResult(room.state, side, shot, result, room.rules);
      trackShot(room.stats, side, shot, result, resolved.events, physics.maxImpulse);
      room.state = resolved.state;
      const wait = (result.ticks * 1000) / 60 + (resolved.events.some((event) => event.type === 'goal') ? 2000 : 0);
      room.opens = Date.now() + wait;
      room.deadline = room.opens + turnMs(room);
      send(room, 2, {
        resolved: { side, shot, preHash, outcome: result.outcome, ticks: result.ticks, hash: result.hash },
        events: resolved.events,
        state: room.state,
        turnMs: wait + turnMs(room),
        turnStartMs: wait,
      });
      if (room.state.phase === 'ENDED') finish(room);
      return {};
    },
  };
}
