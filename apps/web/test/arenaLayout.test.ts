import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { preferredArenaLayout } from '../src/game/arenaLayout';
import { fitArenaCamera } from '../src/game/arenaCamera';

describe('device-specific arena presentation', () => {
  it('keeps phones portrait even when held sideways, and desktop landscape', () => {
    expect(preferredArenaLayout(1280)).toBe('landscape');
    expect(preferredArenaLayout(393)).toBe('portrait');
    expect(preferredArenaLayout(852, true)).toBe('portrait');
  });
  for (const [width, height] of [
    [1280, 800],
    [393, 852],
  ] as const) {
    it(`projects goals onto the appropriate screen axis at ${width}x${height}`, () => {
      const camera = new PerspectiveCamera(34, 1, 0.1, 180);
      fitArenaCamera(camera, width, height, 8.7);
      const left = new Vector3(0, 0, 8.7).project(camera);
      const right = new Vector3(0, 0, -8.7).project(camera);
      const horizontal = Math.abs(left.x - right.x),
        vertical = Math.abs(left.y - right.y);
      if (width > 700) expect(horizontal).toBeGreaterThan(vertical * 5);
      else expect(vertical).toBeGreaterThan(horizontal * 5);
      for (const goal of [left, right]) {
        expect(Math.abs(goal.x)).toBeLessThan(1);
        expect(Math.abs(goal.y)).toBeLessThan(1);
      }
    });
  }
});
