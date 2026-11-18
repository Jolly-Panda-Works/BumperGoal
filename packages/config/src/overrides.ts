// Balance override paths, mirrored from server/nakama/gamedata/overrides.go.
// A path starts with the file name and walks object keys; array elements are
// "@<id>" when they carry an id, otherwise their index:
//   cosmetics/teams/@team_ocean/price   ai-profiles/profiles/@pro/aimErrorDeg   rules/formation/0
// Only balance leaves are editable; the server validates every value.
import arenasJson from '../data/arenas.json';

export type Overrides = Record<string, unknown>;
export type LeafKind = 'number' | 'bool' | 'price' | 'numbers' | 'prices' | 'image' | 'choice' | 'art';

/** Team disc art can be replaced by an uploaded image (a data URL). */
/** Any shop item and AI level can get an uploaded picture. */
export const IMAGE_PATH =
  /^(cosmetics\/(teams|balls|avatars|trails|currencyPacks)|ai-profiles\/profiles)\/@[^/]+\/image$/;
/** Uploaded board art of an arena (see ArenaArt). */
export const ART_PATH = /^arenas\/arenas\/@[^/]+\/art$/;
/** An arena added in the admin panel: the whole arena object. */
export const NEW_ARENA_PATH = /^arenas\/arenas\/\+([a-z][a-z0-9_]{1,23})$/;
const ASSET_REF = /^asset:[0-9a-f]{64}$/;
export const MAX_IMAGE_LENGTH = 60000;
/** An arena's look: one of the board themes the default arenas use. */
export const THEME_PATH = /^arenas\/arenas\/@[^/]+\/theme$/;
export const ARENA_THEMES = [...new Set(arenasJson.arenas.map((a) => a.theme))];
const IMAGE_PREFIX = /^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/;

export const CONFIG_FILES = [
  'economy',
  'cosmetics',
  'arenas',
  'progression',
  'rules',
  'physics',
  'ai-profiles',
] as const;
export type ConfigFile = (typeof CONFIG_FILES)[number];
export type ConfigDocs = Record<ConfigFile, unknown>;

const PRICE_KEYS = new Set(['price', 'grant', 'startingBalance', 'tutorialReward']);
const VARIABLE_LISTS = new Set(['powerSteps', 'angleOffsetsDeg', 'dailyRewards']);
const LOCKED = [
  'rules/discsPerTeam',
  'physics/arena/halfWidth',
  'physics/arena/halfHeight',
  'physics/arena/cornerChamfer',
  'economy/features/payments',
  'economy/features/ads',
  'economy/features/lootBoxes',
  'economy/features/vip',
  'economy/features/seasonPass',
];

type Container = Record<string, unknown> | unknown[];
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Classifies a default value found under `key`; null means not editable. */
export function leafKind(key: string, value: unknown): LeafKind | null {
  if (PRICE_KEYS.has(key)) return 'price';
  if (key === 'dailyRewards') return 'prices';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'bool';
  if (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'number')) return 'numbers';
  return null;
}

/** Whether a list under `key` may change length (otherwise it keeps its default length). */
export const isVariableList = (key: string): boolean => VARIABLE_LISTS.has(key);

export function isLocked(path: string): boolean {
  const segs = path.split('/');
  return LOCKED.some((p) => path === p || path.startsWith(`${p}/`)) || segs.includes('default') || segs.includes('id');
}

/** Path segment for element `i` of an array. */
export function segmentFor(list: unknown[], i: number): string {
  const el = list[i];
  return isObject(el) && typeof el.id === 'string' ? `@${el.id}` : String(i);
}

export interface Leaf {
  parent: Container;
  key: string | number;
  /** Nearest object key: decides the leaf kind and list rules. */
  name: string;
  value: unknown;
  kind: LeafKind;
}

/** Finds the leaf a path names, or null when it does not exist or is not editable. */
export function locate(docs: ConfigDocs, path: string): Leaf | null {
  const [file = '', ...rest] = path.split('/');
  if (rest.length === 0 || !(file in docs) || isLocked(path)) return null;
  let cur: unknown = docs[file as ConfigFile];
  let name = file;
  let parent: Container | null = null;
  let key: string | number = name;
  for (const seg of rest) {
    if (leafKind(name, cur)) return null;
    if (Array.isArray(cur)) {
      let idx = -1;
      if (seg.startsWith('@')) idx = cur.findIndex((e) => isObject(e) && e.id === seg.slice(1));
      else if (/^\d+$/.test(seg) && Number(seg) < cur.length && segmentFor(cur, Number(seg)) === seg) idx = Number(seg);
      if (idx < 0) return null;
      parent = cur;
      key = idx;
      cur = cur[idx];
    } else if (
      isObject(cur) &&
      (seg in cur || (seg === 'image' && IMAGE_PATH.test(path)) || (seg === 'art' && ART_PATH.test(path)))
    ) {
      parent = cur;
      key = seg;
      name = seg;
      cur = cur[seg];
    } else {
      return null;
    }
  }
  const kind = IMAGE_PATH.test(path)
    ? 'image'
    : THEME_PATH.test(path)
      ? 'choice'
      : ART_PATH.test(path)
        ? 'art'
        : leafKind(name, cur);
  return kind && parent ? { parent, key, name, value: cur, kind } : null;
}

function isPrice(v: unknown): boolean {
  return (
    isObject(v) &&
    Object.entries(v).every(
      ([c, n]) => (c === 'coins' || c === 'gems') && typeof n === 'number' && Number.isInteger(n) && n >= 0,
    )
  );
}

/** Shape check for a replacement value; the server applies the full balance rules. */
export function valueFits(leaf: Leaf, value: unknown): boolean {
  switch (leaf.kind) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'bool':
      return typeof value === 'boolean';
    case 'image':
      return typeof value === 'string' && value.length <= MAX_IMAGE_LENGTH && IMAGE_PREFIX.test(value);
    case 'art':
      return isArenaArt(value);
    case 'choice':
      return typeof value === 'string' && ARENA_THEMES.includes(value);
    case 'price':
      return (value === null && leaf.name === 'price') || isPrice(value);
    case 'numbers':
    case 'prices':
      return (
        Array.isArray(value) &&
        value.length > 0 &&
        (isVariableList(leaf.name) || value.length === (leaf.value as unknown[]).length) &&
        value.every((v) => (leaf.kind === 'prices' ? isPrice(v) : typeof v === 'number' && Number.isFinite(v)))
      );
  }
}

export const cloneJson = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

function isArenaArt(value: unknown): boolean {
  if (!isObject(value)) return false;
  return Object.entries(value).every(([part, img]) => {
    if (!['cover', 'background', 'turf', 'frame', 'goal'].includes(part) || !isObject(img)) return false;
    const { src, w, h } = img as Record<string, unknown>;
    return typeof src === 'string' && ASSET_REF.test(src) && typeof w === 'number' && typeof h === 'number';
  });
}

/** Shape check for an arena added in the admin panel (the server validates fully). */
export function isNewArena(value: unknown): boolean {
  if (!isObject(value)) return false;
  const v = value;
  return (
    typeof v.entryFee === 'number' &&
    typeof v.minLevel === 'number' &&
    typeof v.xpMultiplier === 'number' &&
    typeof v.theme === 'string' &&
    ARENA_THEMES.includes(v.theme) &&
    isObject(v.names) &&
    typeof v.names.en === 'string'
  );
}
