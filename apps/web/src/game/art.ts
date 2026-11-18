// Runtime art exported by tools/export-art.mjs (files under public/assets).
// Every lookup may miss: callers keep the procedural placeholder as a fallback.
import { aiProfiles, arenasConfig, cosmetics, type ArenaDef, type ArtImage } from '@flickkick/config';
import { assetRefUrl } from '../services/assets';
import manifest from './artManifest.json';

export interface ArtFile {
  file: string;
  w: number;
  h: number;
}

export interface FrameArt extends ArtFile {
  /** 9-slice insets in texture px; the area between them maps onto the pitch. */
  insets: { left: number; top: number; right: number; bottom: number };
}

export interface ThemeArt {
  bg: ArtFile;
  turf: ArtFile;
  frame: FrameArt;
}

export interface GoalArt extends ArtFile {
  /** Fraction of the width where the goal line (net mouth) sits. */
  mouthX: number;
}

export interface RollArt {
  file: string;
  /** Frame size in px (square) and number of frames for one full turn. */
  frame: number;
  frames: number;
}

interface Manifest {
  scale: number;
  ballRolls?: Record<string, RollArt>;
  ballShade?: ArtFile;
  themes: Record<string, ThemeArt>;
  goal: GoalArt | null;
  discs: Record<string, ArtFile>;
  balls: Record<string, ArtFile>;
  avatars: Record<string, ArtFile>;
  ui: Record<string, ArtFile>;
}

const art = manifest as Manifest;

/** Texture px per game px for board art. */
export const ART_SCALE = art.scale;

export const assetUrl = (file: string): string =>
  /^(blob|data|https?):/.test(file) ? file : `${import.meta.env.BASE_URL}assets/${file}`;
/** A distinct URL per attempt, so a retry never reuses a failed or stalled request. */
export const retryUrl = (url: string, attempt: number): string => (attempt > 0 ? `${url}?retry=${attempt}` : url);

const url = (entry: ArtFile | undefined): string | undefined => (entry ? assetUrl(entry.file) : undefined);

export const DEFAULT_THEME = 'park';

const ARENA_THEME = 'arena:';

/** Uploaded art of an arena as an ArtFile, once the image is loaded. */
function uploaded(img: ArtImage | undefined): ArtFile | undefined {
  const file = assetRefUrl(img?.src);
  return img && file ? { file, w: img.w, h: img.h } : undefined;
}

function arenaOfTheme(theme: string): ArenaDef | undefined {
  if (!theme.startsWith(ARENA_THEME)) return undefined;
  const id = theme.slice(ARENA_THEME.length).split(':')[0];
  return arenasConfig.arenas.find((a) => a.id === id);
}

/**
 * Board theme of an arena id (online) or the default theme (offline). An arena
 * with uploaded art gets its own theme key, which changes when the art changes.
 */
export function themeOf(arenaId: string | undefined): string {
  const arena = arenasConfig.arenas.find((a) => a.id === arenaId);
  if (!arena) return DEFAULT_THEME;
  const parts = Object.values(arena.art ?? {}).filter((img) => assetRefUrl(img.src));
  if (parts.length === 0) return arena.theme;
  return `${ARENA_THEME}${arena.id}:${parts.map((img) => img.src.slice(6, 14)).join('')}`;
}

export function themeArt(theme: string): ThemeArt | undefined {
  const arena = arenaOfTheme(theme);
  const base = art.themes[arena?.theme ?? theme] ?? art.themes[DEFAULT_THEME];
  if (!arena || !base) return base;
  const frame = arena.art?.frame;
  const frameFile = uploaded(frame);
  return {
    bg: uploaded(arena.art?.background) ?? base.bg,
    turf: uploaded(arena.art?.turf) ?? base.turf,
    frame: frame && frameFile ? { ...frameFile, insets: frame.insets } : base.frame,
  };
}

export function goalArt(theme?: string): GoalArt | null {
  const goal = theme ? arenaOfTheme(theme)?.art?.goal : undefined;
  const file = uploaded(goal);
  return goal && file && art.goal ? { ...art.goal, ...file, mouthX: goal.mouthX } : art.goal;
}

/** Arena card image: the uploaded cover, else the theme's card art. */
export function arenaCoverUrl(arena: ArenaDef): string | undefined {
  return assetRefUrl(arena.art?.cover?.src) ?? url(art.ui[`arena_${arena.theme}`]);
}

/** Portrait of a bot level: an image uploaded in the admin panel, else the bundled art. */
export const botPortraitUrl = (profileId: string): string =>
  aiProfiles.find((p) => p.id === profileId)?.image ?? assetUrl(`lobby/bot_${profileId}.webp`);
export const discArt = (teamId: string): ArtFile | undefined => art.discs[teamId];
export const ballArt = (ballId: string): ArtFile | undefined => art.balls[ballId];
export const ballRollArt = (ballId: string): RollArt | undefined => art.ballRolls?.[ballId];
export const ballShadeArt = (): ArtFile | undefined => art.ballShade;
export const avatarArt = (avatarId: string): ArtFile | undefined => art.avatars[avatarId];

/** Avatar portrait: an upload from the admin panel, else the bundled file. */
export const avatarUrl = (avatarId: string): string | undefined =>
  cosmetics.avatars.find((a) => a.id === avatarId)?.image ?? url(art.avatars[avatarId]);
export const bundledAvatarUrl = (avatarId: string): string | undefined => url(art.avatars[avatarId]);
export const uiUrl = (key: string): string | undefined => url(art.ui[key]);
/** The disc art shipped with the build, ignoring admin uploads. */
export const bundledDiscUrl = (teamId: string): string | undefined => url(art.discs[teamId]);

/** Disc art for a team: an image uploaded in the admin panel, else the bundled file. */
export const discUrl = (teamId: string): string | undefined =>
  cosmetics.teams.find((t) => t.id === teamId)?.image ?? url(art.discs[teamId]);

/** Texture key of a team's disc art; an uploaded image gets its own key so a change is reloaded. */
export function discTextureKey(teamId: string): string {
  const image = cosmetics.teams.find((t) => t.id === teamId)?.image;
  return image ? `disc-art-${teamId}-${hashText(image)}` : `disc-art-${teamId}`;
}

function hashText(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
/** Ball art: an upload from the admin panel, else the bundled file. */
export const ballUrl = (ballId: string): string | undefined =>
  cosmetics.balls.find((b) => b.id === ballId)?.image ?? url(art.balls[ballId]);
export const bundledBallUrl = (ballId: string): string | undefined => url(art.balls[ballId]);

/** Texture key of a ball's art; an uploaded image gets its own key so a change is reloaded. */
export function ballTextureKey(ballId: string): string {
  const image = cosmetics.balls.find((b) => b.id === ballId)?.image;
  return image ? `ball-art-${ballId}-${hashText(image)}` : `ball-art-${ballId}`;
}

/** Shop preview of a trail: an upload from the admin panel, else the bundled file. */
export const trailUrl = (trailId: string): string =>
  cosmetics.trails.find((t) => t.id === trailId)?.image ?? assetUrl(`trails/${trailId}.webp`);

/** Every board, piece and UI file. Avatars stay out: they are by far the heaviest group. */
export const streamableArt = (): string[] => [
  ...Object.values(art.themes).flatMap((theme) => [theme.bg.file, theme.turf.file, theme.frame.file]),
  ...(art.goal ? [art.goal.file] : []),
  ...(art.ballShade ? [art.ballShade.file] : []),
  ...Object.values(art.ballRolls ?? {}).map((roll) => roll.file),
  ...[art.discs, art.balls, art.ui].flatMap((group) => Object.values(group).map((entry) => entry.file)),
];
