// Which art each stage of a session needs. Paths are relative to public/assets;
// test/assetBundles.test.ts checks that every one of them exists.
import { cosmetics } from '@flickkick/config';
import { avatarArt, ballArt, ballRollArt, ballShadeArt, discArt, goalArt, streamableArt, themeArt } from './art';

const ICONS = [
  'avatars',
  'balls',
  'formations',
  'history',
  'home',
  'level-reward',
  'locker',
  'packs',
  'rank',
  'settings',
  'shop',
  'teams',
  'trails',
  'tutorial',
];

const ui = (...names: string[]) => names.map((name) => `ui/${name}.webp`);
const trails = () => cosmetics.trails.map((trail) => `trails/${trail.id}.webp`);
const thumbs = () => streamableArt().filter((file) => file.startsWith('thumbs/'));

const present = (files: (string | undefined | null)[]) => files.filter((file): file is string => !!file);

/** Blocks the boot screen: what the first menu paints, including its CSS backgrounds. */
export function baseBundle(promo?: string): string[] {
  return present([
    promo,
    ...ui('wordmark', 'coin', 'gem', 'mode_online', 'mode_ai', 'mode_local'),
    'lobby/background.webp',
    'lobby/menu_background.webp',
    'lobby/card_blue.webp',
    'lobby/card_green.webp',
    'lobby/card_gold.webp',
    ...ICONS.map((name) => `icons/${name}.webp`),
  ]);
}

/** Everything one match draws, so the board is ready when the match opens. */
export function matchBundle(theme: string, teamIds: string[], ballId: string, avatarIds: string[] = []): string[] {
  const board = themeArt(theme);
  return present([
    board?.bg.file,
    board?.turf.file,
    board?.frame.file,
    goalArt()?.file,
    'crowd/fans-atlas.png',
    ...teamIds.map((id) => discArt(id)?.file),
    ballArt(ballId)?.file,
    ballRollArt(ballId)?.file,
    ballShadeArt()?.file,
    ...avatarIds.map((id) => avatarArt(id)?.file),
    ...ui('banner_goal', 'banner_info'),
  ]);
}

/** Art of the screen just opened and of the step most likely to follow it. */
export function screenBundle(pathname: string): string[] {
  if (pathname.startsWith('/play/online')) {
    return ui('vs', 'arena_park', 'arena_city', 'arena_coast', 'arena_capital', 'arena_legends');
  }
  if (pathname === '/play/ai') {
    return ['rookie', 'amateur', 'pro', 'elite'].map((bot) => `lobby/bot_${bot}.webp`);
  }
  if (pathname === '/tutorial') return ui('coach_1', 'coach_2', 'coach_3');
  if (pathname === '/shop') return ['lobby/shop_shelf.webp', ...thumbs(), ...trails()];
  if (pathname === '/locker') return trails();
  if (pathname.startsWith('/rewards')) return [...ui('levelup'), ...thumbs()];
  if (pathname === '/result') return ui('result_victory', 'result_defeat', 'levelup');
  return [];
}

/** Fills the cache after the first screen is up, except music and avatars. */
export function idleBundle(): string[] {
  return ['lobby/shop_shelf.webp', 'crowd/fans-atlas.png', ...streamableArt(), ...trails()];
}
