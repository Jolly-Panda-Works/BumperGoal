import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { baseBundle, idleBundle, matchBundle, screenBundle } from '../src/game/assetBundles';

const SCREENS = ['/play/online', '/play/ai', '/tutorial', '/shop', '/locker', '/rewards', '/result'];
const assets = fileURLToPath(new URL('../public/assets/', import.meta.url));

describe('asset bundles', () => {
  it('lists only files that exist', () => {
    const files = [
      ...baseBundle('ui/promo_portrait.webp'),
      ...matchBundle('city', ['team_volt', 'team_coral'], 'ball_classic'),
      ...SCREENS.flatMap(screenBundle),
      ...idleBundle(),
    ];
    expect(files.filter((file) => !existsSync(assets + file))).toEqual([]);
  });

  it('gives every screen with its own art a bundle', () => {
    SCREENS.forEach((screen) => expect(screenBundle(screen).length).toBeGreaterThan(0));
  });

  it('keeps avatars and music out of the background stream', () => {
    expect(idleBundle().filter((file) => /^(avatars|music)\//.test(file))).toEqual([]);
  });

  it('includes the board of the chosen theme for a match', () => {
    expect(matchBundle('city', [], 'ball_classic')).toContain('board/city/turf.webp');
  });

  it('includes the avatars shown beside the match board', () => {
    expect(matchBundle('park', [], 'ball_classic', ['bot', 'avatar_fox'])).toEqual(
      expect.arrayContaining(['avatars/bot.webp', 'avatars/fox.webp']),
    );
  });
});
