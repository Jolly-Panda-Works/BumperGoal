// Offline profile for local play (ARCHITECTURE §7). It never grants online
// rewards: local results only feed practice statistics and local history.
import { useSyncExternalStore } from 'react';
import { cosmetics, resolveTeamId } from '@flickkick/config';
import type { EndReason, MatchMode } from '@flickkick/rules';
import type { MatchStatistics } from '../game/matchStatistics';
import type { Side } from '@flickkick/rules';
import { Store } from './storage';

export interface LocalMatchRecord {
  playerName?: string;
  playerAvatarId?: string;
  opponentAvatarId?: string;
  teamId?: string;
  opponentTeamId?: string;
  playerSide?: Side;
  statistics?: MatchStatistics;
  id: string;
  endedAt: number;
  mode: MatchMode;
  opponentName: string;
  opponentIsBot: boolean;
  aiProfile: string | null;
  scoreFor: number;
  scoreAgainst: number;
  won: boolean;
  reason: EndReason;
}

export type PendingProfileChanges = Partial<{
  displayName: string;
  teamId: string;
  ballId: string;
  avatarId: string;
  formationId: string;
  trailId: string;
}>;

export interface LocalProfile {
  displayName: string;
  avatarId: string;
  teamId: string;
  ballId: string;
  formationId: string;
  trailId: string;
  tutorialDone: boolean;
  welcomed: boolean;
  /** Last level known from the server; drives AI difficulty offline. Starts at 1. */
  knownLevel: number;
  knownXP: number;
  pendingLevelUps: number[];
  username?: string;
  playerCode?: string;
  practice: { played: number; won: number; lost: number; goalsFor: number; goalsAgainst: number };
  history: LocalMatchRecord[];
  /** Edits made while not connected; pushed to the server (and validated there) on the next connect. */
  pending: PendingProfileChanges;
}

const HISTORY_LIMIT = 50;

const defaultOf = <T extends { id: string; default?: boolean }>(items: T[]): string =>
  (items.find((i) => i.default) ?? items[0])!.id;

export const defaultProfile = (): LocalProfile => ({
  displayName: '',
  avatarId: defaultOf(cosmetics.avatars),
  teamId: defaultOf(cosmetics.teams),
  ballId: defaultOf(cosmetics.balls),
  formationId: defaultOf(cosmetics.formations),
  trailId: '',
  tutorialDone: false,
  welcomed: false,
  knownLevel: 1,
  knownXP: 0,
  pendingLevelUps: [],
  practice: { played: 0, won: 0, lost: 0, goalsFor: 0, goalsAgainst: 0 },
  history: [],
  pending: {},
});

export const DISPLAY_NAME_PATTERN = /^[\p{L}\p{N}_ .-]{3,16}$/u;

export function isValidDisplayName(name: string): boolean {
  return DISPLAY_NAME_PATTERN.test(name.trim());
}

/** Only free (default) cosmetics are usable offline; owned items come from the server. */
export function isFreeCosmetic(kind: 'teams' | 'balls' | 'avatars', id: string): boolean {
  return cosmetics[kind].some((i) => i.id === id && i.price === null);
}

export const profileStore = new Store<LocalProfile>('flickkick.profile.v1', defaultProfile(), (raw) => {
  const d = defaultProfile();
  return {
    ...d,
    ...raw,
    teamId: resolveTeamId(raw.teamId ?? d.teamId),
    pendingLevelUps: Array.isArray(raw.pendingLevelUps)
      ? raw.pendingLevelUps.filter((n) => Number.isInteger(n) && n > 1 && n <= 50)
      : [],
    practice: { ...d.practice, ...(raw.practice ?? {}) },
    history: Array.isArray(raw.history) ? raw.history.slice(0, HISTORY_LIMIT) : [],
    pending:
      raw.pending && typeof raw.pending === 'object'
        ? { ...raw.pending, ...(raw.pending.teamId ? { teamId: resolveTeamId(raw.pending.teamId) } : {}) }
        : {},
  };
});

export function recordLocalMatch(record: LocalMatchRecord): void {
  profileStore.set((p) => ({
    ...p,
    practice: {
      played: p.practice.played + 1,
      won: p.practice.won + (record.won ? 1 : 0),
      lost: p.practice.lost + (record.won ? 0 : 1),
      goalsFor: p.practice.goalsFor + record.scoreFor,
      goalsAgainst: p.practice.goalsAgainst + record.scoreAgainst,
    },
    history: [record, ...p.history].slice(0, HISTORY_LIMIT),
  }));
}

export function useLocalProfile(): LocalProfile {
  return useSyncExternalStore(profileStore.subscribe, profileStore.get);
}

/** Receipts from authoritative level changes. Acknowledgement never grants currency. */
export function queueLevelUps(pending: number[], previous: number, current: number): number[] {
  return [
    ...new Set([
      ...pending,
      ...Array.from({ length: Math.max(0, Math.min(50, current) - previous) }, (_, i) => previous + i + 1),
    ]),
  ];
}
export function acknowledgeLevelUp(level: number): void {
  profileStore.set((profile) => ({
    ...profile,
    pendingLevelUps: profile.pendingLevelUps.filter((item) => item !== level),
  }));
}
