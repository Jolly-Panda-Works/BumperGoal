import { profileStore } from '../services/localProfile';
import type { MatchTransport } from '../game/OnlineMatchController';
import type { MatchMessage } from '../services/online';

function sessionToken() {
  const key = 'flickkick.local-friends.tab';
  let token = sessionStorage.getItem(key);
  if (!token) {
    token = crypto.randomUUID();
    sessionStorage.setItem(key, token);
  }
  return token;
}
export async function localFriendRequest<T = Record<string, unknown>>(
  action: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const { displayName, teamId, avatarId, formationId, trailId } = profileStore.get();
    const response = await fetch('/__local-friends', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Local-Session': sessionToken() },
      body: JSON.stringify({ ...body, action, profile: { displayName, teamId, avatarId, formationId, trailId } }),
      signal: controller.signal,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(String(result.error ?? 'unavailable'));
    return result as T;
  } finally {
    clearTimeout(timeout);
  }
}

const transports = new Map<string, MatchTransport>();
export function localMatchTransport(matchId: string): MatchTransport {
  const existing = transports.get(matchId);
  if (existing) return existing;
  const dataListeners = new Set<(message: MatchMessage) => void>();
  const disconnected = new Set<() => void>();
  const reconnected = new Set<() => void>();
  let generation = 0,
    cursor = 0;
  let timer: ReturnType<typeof setTimeout>;
  let offline = false;
  const poll = async (version: number) => {
    try {
      const result = await localFriendRequest('events', { matchId, after: cursor });
      if (version !== generation) return;
      if (offline) {
        offline = false;
        reconnected.forEach((listener) => listener());
        return;
      }
      for (const event of result.events as (MatchMessage & { serial: number })[]) {
        cursor = Math.max(cursor, event.serial);
        dataListeners.forEach((listener) => listener(event));
      }
    } catch {
      if (version !== generation) return;
      if (!offline) {
        offline = true;
        disconnected.forEach((listener) => listener());
      }
    }
    if (version === generation) timer = setTimeout(() => void poll(version), offline ? 1000 : 120);
  };
  const transport: MatchTransport = {
    onData(listener) {
      dataListeners.add(listener);
      return () => {
        dataListeners.delete(listener);
        if (!dataListeners.size) {
          generation++;
          clearTimeout(timer);
        }
      };
    },
    onDisconnected(listener) {
      disconnected.add(listener);
      return () => {
        disconnected.delete(listener);
      };
    },
    onReconnected(listener) {
      reconnected.add(listener);
      return () => {
        reconnected.delete(listener);
      };
    },
    async socket() {
      return {
        async joinMatch() {
          const version = ++generation;
          clearTimeout(timer);
          cursor = 0;
          offline = false;
          await localFriendRequest('connect', { matchId });
          if (version === generation) void poll(version);
        },
        async sendMatchState(_id, op, data) {
          await localFriendRequest('command', { matchId, op, data });
        },
        async leaveMatch() {
          generation++;
          clearTimeout(timer);
          await localFriendRequest('disconnect', { matchId });
        },
      };
    },
  };
  transports.set(matchId, transport);
  return transport;
}
