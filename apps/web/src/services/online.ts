import { rakhtkan } from './gameVariant';
import { screenPreview } from '../dev/mode';
// Nakama connection: guest device auth, session persistence and refresh,
// server-owned profile/wallet. Only session tokens are stored on the device,
// never passwords (ARCHITECTURE §11).
import { useSyncExternalStore } from 'react';
import { Client, Session, type Socket } from '@heroiclabs/nakama-js';
import { readJson, removeKey, writeJson } from './storage';
import { profileStore, queueLevelUps, type PendingProfileChanges } from './localProfile';
import { mirrorServerInventory, type CosmeticKind } from './localInventory';
import { configAssetRefs, ensureAssets, type FetchedAsset } from './assets';
import { syncServerConfig, syncServerLanguages } from './remoteConfig';

function withoutSent(pending: PendingProfileChanges, sent: PendingProfileChanges): PendingProfileChanges {
  const out: PendingProfileChanges = { ...pending };
  for (const key of Object.keys(sent) as (keyof PendingProfileChanges)[]) {
    if (out[key] === sent[key]) delete out[key];
  }
  return out;
}

export type OnlineStatus = 'disabled' | 'connecting' | 'online' | 'offline' | 'error';

export interface ServerProfile {
  ownedFormations?: string[];
  ownedTrails?: string[];
  ownedTeams?: string[];
  ownedBalls?: string[];
  ownedAvatars?: string[];
  userId: string;
  username: string;
  playerCode: string;
  displayName: string;
  level: number;
  xp: number;
  wallet: { coins?: number; gems?: number };
  stats: {
    played: number;
    won: number;
    lost: number;
    goalsFor: number;
    goalsAgainst: number;
    winStreak: number;
    bestStreak: number;
  };
  daily?: { index: number; claimedToday: boolean };
  loadout: { teamId: string; ballId: string; avatarId: string; formationId?: string; trailId?: string };
  emailLinked: boolean;
  simVersion: number;
  /** Admin balance revision; the client refetches config_get when it changes. */
  configRevision?: number;
  /** Admin languages revision; the client refetches languages_get when it changes. */
  languagesRevision?: number;
}

export interface OnlineState {
  status: OnlineStatus;
  profile: ServerProfile | null;
  error: string | null;
}

const env = import.meta.env;
const HOST = (env.VITE_NAKAMA_HOST as string | undefined) ?? '';
const PORT = (env.VITE_NAKAMA_PORT as string | undefined) ?? '7350';
const SSL = env.VITE_NAKAMA_SSL === 'true';
const SERVER_KEY = (env.VITE_NAKAMA_SERVER_KEY as string | undefined) ?? '';

const DEVICE_KEY = 'flickkick.device.v1';
const SESSION_KEY = 'flickkick.session.v1';

export const onlineConfigured = !screenPreview && HOST !== '' && SERVER_KEY !== '';

const client: Client | null = onlineConfigured ? new Client(SERVER_KEY, HOST, PORT, SSL, 7000) : null;
let session: Session | null = null;
let state: OnlineState = { status: onlineConfigured ? 'offline' : 'disabled', profile: null, error: null };
const listeners = new Set<() => void>();

function setState(patch: Partial<OnlineState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useOnline(): OnlineState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export const getOnline = (): OnlineState => state;

function deviceId(): string {
  let id = readJson<string>(DEVICE_KEY);
  if (!id || id.length < 10) {
    id = crypto.randomUUID();
    writeJson(DEVICE_KEY, id);
  }
  return id;
}

function saveSession(s: Session): void {
  session = s;
  writeJson(SESSION_KEY, { token: s.token, refresh: s.refresh_token });
}

async function restoreOrAuthenticate(c: Client): Promise<Session> {
  const saved = readJson<{ token: string; refresh: string }>(SESSION_KEY);
  const now = Date.now() / 1000;
  if (saved) {
    const restored = Session.restore(saved.token, saved.refresh);
    if (!restored.isexpired(now + 60)) return restored;
    if (!restored.isrefreshexpired(now + 60)) {
      try {
        return await c.sessionRefresh(restored);
      } catch {
        // fall through to device auth
      }
    }
  }
  return c.authenticateDevice(deviceId(), true);
}

async function call<T>(id: string, input: object = {}): Promise<T> {
  if (!client || !session) throw new Error('not connected');
  if (session.isexpired(Date.now() / 1000 + 30)) saveSession(await client.sessionRefresh(session));
  const res = await client.rpc(session, id, input);
  return res.payload as T;
}

function applyProfile(p: ServerProfile): void {
  void syncServerConfig(p.configRevision, () => call('config_get'))
    .then(() => ensureAssets(configAssetRefs(), (id) => call<FetchedAsset>('asset_get', { id })))
    .catch(() => undefined);
  void syncServerLanguages(p.languagesRevision, (input) => call('languages_get', input)).catch(() => undefined);
  setState({ status: 'online', profile: p, error: null });
  mirrorServerInventory(p);
  // Server-owned values drive offline behaviour (AI difficulty) and the local loadout cache.
  // Fields with an unsent local edit keep the local value until it is pushed.
  profileStore.set((local) => {
    const pending = local.pending;
    return {
      ...local,
      pendingLevelUps: queueLevelUps(local.pendingLevelUps, local.knownLevel, p.level),
      knownLevel: p.level,
      username: p.username,
      playerCode: p.playerCode,
      knownXP: p.xp,
      teamId: pending.teamId ?? p.loadout.teamId,
      ballId: pending.ballId ?? p.loadout.ballId,
      formationId: pending.formationId ?? (p.loadout.formationId || local.formationId),
      trailId: pending.trailId ?? p.loadout.trailId ?? '',
      avatarId: pending.avatarId ?? p.loadout.avatarId,
      displayName: pending.displayName ?? (p.displayName || local.displayName),
    };
  });
}

/** Connects (or reconnects) as the guest of this device. Safe to call repeatedly. */
export async function connect(): Promise<void> {
  if (!client || state.status === 'connecting') return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    setState({ status: 'offline' });
    return;
  }
  setState({ status: 'connecting', error: null });
  try {
    saveSession(await restoreOrAuthenticate(client));
    let profile = await call<ServerProfile>('profile_get');
    // Push edits made while offline/connecting; a new account adopts the local name.
    // Edits made while a push is in flight stay pending and go in the next round.
    for (let round = 0; round < 3; round++) {
      const local = profileStore.get();
      const changes: PendingProfileChanges = { ...local.pending };
      if (round === 0 && !profile.displayName && local.displayName && !changes.displayName) {
        changes.displayName = local.displayName;
      }
      if (Object.keys(changes).length === 0) break;
      try {
        profile = await call<ServerProfile>('profile_update', changes);
      } catch {
        // Rejected by server validation: the server state wins for these fields.
      }
      profileStore.set((p) => ({ ...p, pending: withoutSent(p.pending, changes) }));
    }
    applyProfile(profile);
    const invitation = localStorage.getItem('flickkick.invitation');
    if (!rakhtkan && invitation && /^[1-9][0-9]{7}$/.test(invitation)) {
      try {
        await call('referral_apply', { playerCode: invitation });
        localStorage.removeItem('flickkick.invitation');
        applyProfile(await call<ServerProfile>('profile_get'));
      } catch (error) {
        // Keep a code on transport failure; a rejected code can be corrected in Profile.
        if (error instanceof Response && error.status < 500) localStorage.removeItem('flickkick.invitation');
      }
    }
  } catch (err) {
    session = null;
    setState({ status: 'error', error: err instanceof Error ? err.message : 'connection failed' });
  }
}

export async function refreshProfile(): Promise<void> {
  if (state.status !== 'online') return connect();
  applyProfile(await call<ServerProfile>('profile_get'));
}

/** Server-validated profile change. Throws with the server's message on rejection. */
export async function updateProfile(patch: PendingProfileChanges & { username?: string }): Promise<void> {
  try {
    const profile = await call<ServerProfile>('profile_update', patch);
    profileStore.set((p) => ({ ...p, pending: withoutSent(p.pending, patch) }));
    applyProfile(profile);
  } catch (err) {
    // Rejected (or unreachable): drop the rejected edit only if the server answered.
    if (err instanceof Response) {
      profileStore.set((p) => ({ ...p, pending: withoutSent(p.pending, patch) }));
      void refreshProfile().catch(() => undefined);
    }
    throw new Error(await describeError(err), { cause: err });
  }
}

/** Links email + password to the guest account for recovery on other devices. */
export async function linkEmail(email: string, password: string): Promise<void> {
  if (!client || !session) throw new Error('not connected');
  try {
    await client.linkEmail(session, { email, password });
  } catch (err) {
    throw new Error(await describeError(err), { cause: err });
  }
  await refreshProfile();
}

/** Signs in to an existing account (recovery). Replaces this device's guest session. */
export async function signInWithEmail(email: string, password: string): Promise<void> {
  if (!client) throw new Error('online services are not configured');
  try {
    saveSession(await client.authenticateEmail(email, password, false));
  } catch (err) {
    throw new Error(await describeError(err), { cause: err });
  }
  applyProfile(await call<ServerProfile>('profile_get'));
}

export function signOut(): void {
  session = null;
  removeKey(SESSION_KEY);
  setState({ status: onlineConfigured ? 'offline' : 'disabled', profile: null });
}

/** The server's message for a failed call. */
export async function describeError(err: unknown): Promise<string> {
  if (err instanceof Response) {
    try {
      const body = (await err.json()) as { message?: string };
      return body.message ?? `HTTP ${err.status}`;
    } catch {
      return `HTTP ${err.status}`;
    }
  }
  return err instanceof Error ? err.message : String(err);
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void connect());
  window.addEventListener('offline', () => setState({ status: 'offline' }));
}

// ---------------------------------------------------------------------------
// Realtime socket (matchmaking, notifications, authoritative matches)
// ---------------------------------------------------------------------------

export interface MatchMessage {
  matchId: string;
  op: number;
  data: Record<string, unknown>;
}

type SocketEvents = {
  matchData: MatchMessage;
  notification: { code: number; content: Record<string, unknown> };
  matched: { matchId: string };
  disconnected: null;
  reconnected: null;
};

const socketListeners: { [K in keyof SocketEvents]: Set<(e: SocketEvents[K]) => void> } = {
  matchData: new Set(),
  notification: new Set(),
  matched: new Set(),
  disconnected: new Set(),
  reconnected: new Set(),
};

export function onSocket<K extends keyof SocketEvents>(event: K, fn: (e: SocketEvents[K]) => void): () => void {
  socketListeners[event].add(fn);
  return () => socketListeners[event].delete(fn);
}

function emitSocket<K extends keyof SocketEvents>(event: K, e: SocketEvents[K]): void {
  socketListeners[event].forEach((fn) => fn(e));
}

let socket: Socket | null = null;
let socketPromise: Promise<Socket> | null = null;
let reconnecting = false;
const decoder = new TextDecoder();

/** Connects the realtime socket once per session; reconnects after drops. */
export function getSocket(): Promise<Socket> {
  if (socket) return Promise.resolve(socket);
  if (!client || !session) return Promise.reject(new Error('not connected'));
  const c = client;
  const s = session;
  socketPromise ??= (async () => {
    const sock = c.createSocket(SSL, false);
    sock.onmatchdata = (m) => {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(decoder.decode(m.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      emitSocket('matchData', { matchId: m.match_id, op: m.op_code, data });
    };
    sock.onnotification = (n) =>
      emitSocket('notification', { code: n.code ?? 0, content: (n.content ?? {}) as Record<string, unknown> });
    sock.onmatchmakermatched = (m) => {
      if (m.match_id) emitSocket('matched', { matchId: m.match_id });
    };
    sock.ondisconnect = () => {
      socket = null;
      socketPromise = null;
      emitSocket('disconnected', null);
      void reconnectSocket();
    };
    await sock.connect(s, true);
    socket = sock;
    return sock;
  })().catch((err: unknown) => {
    socketPromise = null;
    throw err;
  });
  return socketPromise;
}

async function reconnectSocket(): Promise<void> {
  if (reconnecting) return;
  reconnecting = true;
  for (let attempt = 0; attempt < 8; attempt++) {
    await new Promise((r) => setTimeout(r, Math.min(500 * 2 ** attempt, 8000)));
    try {
      if (session && client && session.isexpired(Date.now() / 1000 + 30))
        saveSession(await client.sessionRefresh(session));
      await getSocket();
      reconnecting = false;
      emitSocket('reconnected', null);
      return;
    } catch {
      // keep trying
    }
  }
  reconnecting = false;
  setState({ status: 'error', error: 'realtime connection lost' });
}

export function currentUserId(): string | null {
  return session?.user_id ?? null;
}

export function rpc<T>(id: string, input: object = {}): Promise<T> {
  return call<T>(id, input).catch(async (err: unknown) => {
    throw new Error(await describeError(err), { cause: err });
  });
}

/** Charges the server wallet and records ownership on the server. */
export async function purchaseItem(kind: CosmeticKind, id: string): Promise<void> {
  applyProfile(await call<ServerProfile>('item_purchase', { kind, id }));
}

/** Credits today's daily reward to the server wallet. */
export async function claimDaily(): Promise<void> {
  applyProfile(await call<ServerProfile>('daily_claim'));
}

/** Credits a currency pack to the server wallet. */
export async function claimPack(id: string): Promise<void> {
  applyProfile(await call<ServerProfile>('pack_claim', { id }));
}
