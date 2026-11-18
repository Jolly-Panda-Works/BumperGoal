import { describe, expect, it } from 'vitest';
import { retryUrl } from '../src/game/art';

describe('retryUrl', () => {
  it('keeps the original URL for the first request', () => {
    expect(retryUrl('/assets/icons/shop.webp', 0)).toBe('/assets/icons/shop.webp');
  });

  it('makes each retry a distinct request', () => {
    expect(retryUrl('/assets/icons/shop.webp', 1)).toBe('/assets/icons/shop.webp?retry=1');
    expect(retryUrl('/assets/icons/shop.webp', 2)).not.toBe(retryUrl('/assets/icons/shop.webp', 1));
  });
});
