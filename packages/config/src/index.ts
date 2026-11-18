// Typed access to FlickKick's data-driven configuration (packages/config/data).
// The Go server reads the same JSON files; never hardcode these values elsewhere.
import teamAliasesJson from '../data/team-aliases.json';
import aiProfilesJson from '../data/ai-profiles.json';
import arenasJson from '../data/arenas.json';
import cosmeticsJson from '../data/cosmetics.json';
import economyJson from '../data/economy.json';
import physicsJson from '../data/physics.json';
import progressionJson from '../data/progression.json';
import rulesJson from '../data/rules.json';
import { NEW_ARENA_PATH, cloneJson, isNewArena, locate, valueFits, type ConfigDocs, type Overrides } from './overrides';

export * from './overrides';

export interface BodyParams {
  /** Optional rounded car rectangle; radius remains the conservative query bound. */
  halfLength?: number;
  halfWidth?: number;
  borderRadius?: number;
  angularDamping?: number;
  radius: number;
  density: number;
  linearDamping: number;
  restitution: number;
}

export interface ArenaGeometry {
  halfWidth: number;
  halfHeight: number;
  goalHalfWidth: number;
  goalDepth: number;
  wallRestitution: number;
  stopSpeed: number;
  /** Leg length of the 45° cut at each pitch corner, so a ball can never be wedged in a corner. */
  cornerChamfer: number;
}

export interface PhysicsConfig {
  arena: ArenaGeometry;
  disc: BodyParams;
  ball: BodyParams;
  maxStepsPerShot: number;
  maxImpulse: number;
  minImpulse: number;
  boundsMargin: number;
}

export interface RulesConfig {
  carMassScales?: [number, number];
  discsPerTeam: number;
  goalsToWin: number;
  turnTimeMs: number;
  timeoutForfeitCount: number;
  maxShots: number;
  /** Positions for the left team; the right team is mirrored on x. */
  formation: [number, number][];
  opponentFormation?: [number, number][];
}

export interface AIProfile {
  id: 'rookie' | 'amateur' | 'pro' | 'elite';
  minLevel: number;
  maxSimulations: number;
  powerSteps: number[];
  angleOffsetsDeg: number[];
  bankShots: boolean;
  lookAhead: boolean;
  aimErrorDeg: number;
  powerError: number;
  defensiveWeight: number;
  riskTolerance: number;
  thinkTimeMs: number;
  /** Portrait uploaded in the admin panel (data URL). */
  image?: string;
}

export interface ProgressionConfig {
  maxLevel: number;
  levelCurve: { base: number; exponent: number };
  xp: { win: number; loss: number; perGoal: number };
  levelReward: { coinsPerLevel: number; gemsEveryNLevels: number; gemsAmount: number };
}

/** An uploaded image ("asset:<sha256>" from the admin panel) and its size in px. */
export interface ArtImage {
  src: string;
  w: number;
  h: number;
}
/** Board art uploaded for an arena; missing parts use the arena's theme. */
export interface ArenaArt {
  cover?: ArtImage;
  background?: ArtImage;
  turf?: ArtImage;
  /** Nine-slice border: insets in image px around the pitch opening. */
  frame?: ArtImage & { insets: { left: number; top: number; right: number; bottom: number } };
  /** Goal opening to the right; mouthX is the goal line as a share of the width. */
  goal?: ArtImage & { mouthX: number };
}

export interface ArenaDef {
  id: string;
  entryFee: number;
  minLevel: number;
  xpMultiplier: number;
  theme: string;
  /** Display names of arenas added in the admin panel, by language code. */
  names?: Record<string, string>;
  art?: ArenaArt;
}

export type CurrencyId = 'coins' | 'gems';
export type Price = Partial<Record<CurrencyId, number>>;

/** Shop/locker section: FlickKick's own teams, national teams (flags), clubs. */
export type TeamGroup = 'original' | 'nation' | 'club';

export interface TeamAttributes {
  weight: number;
  force: number;
  time: number;
  aim: number;
}
export interface TeamDef {
  carModel: 'cicada' | 'cruiser' | 'carrier';
  attributes: TeamAttributes;
  id: string;
  group: TeamGroup;
  primary: string;
  secondary: string;
  emblem: string;
  price: Price | null;
  default?: boolean;
  /** Disc art uploaded in the admin panel (data URL); replaces the bundled art. */
  image?: string;
}

export interface TrailDef {
  id: string;
  colors: string[];
  pattern: 'ribbon' | 'twin' | 'dash' | 'spark';
  price: Price;
  /** Shop picture uploaded in the admin panel (data URL). */
  image?: string;
}

export interface FormationDef {
  id: string;
  positions: [number, number][];
  price: Price | null;
  default?: boolean;
}

export interface BallDef {
  id: string;
  primary: string;
  secondary: string;
  price: Price | null;
  default?: boolean;
  /** Ball art uploaded in the admin panel (data URL); also drawn in matches. */
  image?: string;
}

export interface AvatarDef {
  id: string;
  price: Price | null;
  default?: boolean;
  /** Portrait uploaded in the admin panel (data URL). */
  image?: string;
}

export interface CurrencyPackDef {
  id: string;
  grant: Price;
  priceLabel: string;
  oneTime?: boolean;
  /** Shop picture uploaded in the admin panel (data URL). */
  image?: string;
}

export interface EconomyConfig {
  currencies: { id: CurrencyId; kind: 'soft' | 'premium' }[];
  startingBalance: Record<CurrencyId, number>;
  tutorialReward: Price;
  dailyRewards: Price[];
  rewardedAd: { coins: number; dailyCap: number };
  features: {
    payments: { enabled: boolean; provider: string };
    ads: { rewarded: boolean; interstitial: boolean; provider: string };
    lootBoxes: boolean;
    vip: boolean;
    seasonPass: boolean;
    /** Club discs show real club crests: they need licences before a public release. */
    clubTeams: { enabled: boolean; note?: string };
  };
}

export const physicsConfig = physicsJson as PhysicsConfig;
export const rulesConfig = rulesJson as RulesConfig;
export const aiProfiles = (aiProfilesJson as { profiles: AIProfile[] }).profiles;
export const progressionConfig = progressionJson as ProgressionConfig;
export const arenasConfig = arenasJson as { houseCut: number; arenas: ArenaDef[] };
export const economyConfig = economyJson as EconomyConfig;
const allCosmetics = cosmeticsJson as {
  trails: TrailDef[];
  formations: FormationDef[];
  teams: TeamDef[];
  balls: BallDef[];
  avatars: AvatarDef[];
  currencyPacks: CurrencyPackDef[];
};
const offeredTeams = () =>
  allCosmetics.teams.filter((t) => t.group !== 'club' || economyConfig.features.clubTeams.enabled);
/** The catalog the game offers: club teams drop out when the clubTeams switch is off. */
export const cosmetics = { ...allCosmetics, teams: offeredTeams() };

// ---- Server balance overrides ----
// The exported objects above are edited in place, so every importer (and every
// FlickSim built from physicsConfig) sees the server's balance without re-importing.
const liveDocs: ConfigDocs = {
  economy: economyJson,
  cosmetics: cosmeticsJson,
  arenas: arenasJson,
  progression: progressionJson,
  rules: rulesJson,
  physics: physicsJson,
  'ai-profiles': aiProfilesJson,
};
const defaultDocs = cloneJson(liveDocs);
const defaultArenaIds = arenasConfig.arenas.map((a) => a.id);
let appliedPaths: string[] = [];
let applied: { revision: number; overrides: Overrides } = { revision: 0, overrides: {} };
const configListeners = new Set<() => void>();

/** A fresh copy of the bundled defaults, keyed by file. */
export const configDefaults = (): ConfigDocs => cloneJson(defaultDocs);

/** The overrides currently applied and the server revision they came from. */
export const appliedConfig = (): { revision: number; overrides: Overrides } => applied;

export function subscribeConfig(fn: () => void): () => void {
  configListeners.add(fn);
  return () => configListeners.delete(fn);
}

/**
 * Replaces the applied overrides (restoring defaults first). Paths unknown to
 * this build are skipped and returned.
 */
export function applyConfigOverrides(revision: number, overrides: Overrides): string[] {
  for (const path of appliedPaths) {
    const leaf = locate(liveDocs, path);
    const def = locate(defaultDocs, path);
    if (leaf && def) (leaf.parent as Record<string | number, unknown>)[leaf.key] = cloneJson(def.value);
  }
  appliedPaths = [];
  // Arenas added in the panel go first, so later paths can edit them.
  const defaultIds = new Set(defaultArenaIds);
  for (let i = arenasConfig.arenas.length - 1; i >= 0; i--) {
    if (!defaultIds.has(arenasConfig.arenas[i]!.id)) arenasConfig.arenas.splice(i, 1);
  }
  const skipped: string[] = [];
  const kept: Overrides = {};
  const entries = Object.entries(overrides).sort(
    ([a], [b]) => Number(!NEW_ARENA_PATH.test(a)) - Number(!NEW_ARENA_PATH.test(b)),
  );
  for (const [path, value] of entries) {
    const added = NEW_ARENA_PATH.exec(path)?.[1];
    if (added) {
      if (!isNewArena(value) || arenasConfig.arenas.some((a) => a.id === added)) {
        skipped.push(path);
        continue;
      }
      arenasConfig.arenas.push({ ...(cloneJson(value) as Omit<ArenaDef, 'id'>), id: added });
      kept[path] = value;
      continue;
    }
    const leaf = locate(liveDocs, path);
    if (!leaf || !valueFits(leaf, value)) {
      skipped.push(path);
      continue;
    }
    (leaf.parent as Record<string | number, unknown>)[leaf.key] = cloneJson(value);
    appliedPaths.push(path);
    kept[path] = value;
  }
  cosmetics.teams = offeredTeams();
  applied = { revision, overrides: kept };
  configListeners.forEach((l) => l());
  return skipped;
}

/** Winner's prize for an arena: both entry fees minus the house cut. */
export function arenaPrize(arena: ArenaDef, houseCut = arenasConfig.houseCut): number {
  return Math.round(arena.entryFee * 2 * (1 - houseCut));
}

/** Fixed team abilities; unknown legacy/test teams retain the base gameplay limits. */
export function teamAttributes(id: string): TeamAttributes {
  return cosmetics.teams.find((t) => t.id === id)?.attributes ?? { force: 6, time: 6, aim: 6, weight: 6 };
}
/** Effect of each team attribute (1-10); mirrored in server/nakama/gamedata (TeamMaxImpulse, TeamTurnMs). */
export const weightScale = (weight: number): number => 0.7 + 0.06 * weight;
export const forceScale = (force: number): number => 0.7 + 0.03 * force;
export const timeScale = (time: number): number => 0.6 + time / 15;
export const aimRange = (aim: number): number => 260 * (0.4 + aim / 10);

export function teamPhysics(id: string, base: PhysicsConfig): PhysicsConfig {
  const team = cosmetics.teams.find((t) => t.id === id);
  return team ? { ...base, maxImpulse: base.maxImpulse * forceScale(team.attributes.force) } : base;
}
export function teamTurnTime(id: string, baseMs: number): number {
  const team = cosmetics.teams.find((t) => t.id === id);
  return team ? Math.round(baseMs * timeScale(team.attributes.time)) : baseMs;
}
export function teamAimRange(id: string): number {
  return aimRange(teamAttributes(id).aim);
}

/** Legacy team purchases keep the corresponding real car model. */
export function legacyTeamId(id: string): string {
  return (teamAliasesJson as Record<string, string>)[id] ?? id;
}
export function resolveTeamId(id: string): string {
  const mapped = legacyTeamId(id);
  return cosmetics.teams.some((t) => t.id === mapped) ? mapped : cosmetics.teams[0]!.id;
}
export function carModelForTeam(id: string): TeamDef['carModel'] {
  return cosmetics.teams.find((t) => t.id === resolveTeamId(id))!.carModel;
}
