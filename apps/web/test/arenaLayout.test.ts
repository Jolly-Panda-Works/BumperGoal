import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { fitArenaCamera } from '../src/game/arenaCamera';

describe('landscape arena presentation', () => {
  for (const [width, height] of [
    [1280, 800],
    [852, 393],
    [667, 375],
  ] as const) {
    it(`projects goals onto the horizontal axis at ${width}x${height}`, () => {
      const camera = new PerspectiveCamera(34, 1, 0.1, 180);
      fitArenaCamera(camera, width, height, 8.7);
      const left = new Vector3(0, 0, 8.7).project(camera);
      const right = new Vector3(0, 0, -8.7).project(camera);
      const horizontal = Math.abs(left.x - right.x),
        vertical = Math.abs(left.y - right.y);
      expect(horizontal).toBeGreaterThan(vertical * 5);
      for (const goal of [left, right]) {
        expect(Math.abs(goal.x)).toBeLessThan(1);
        expect(Math.abs(goal.y)).toBeLessThan(1);
      }
    });
  }
});
