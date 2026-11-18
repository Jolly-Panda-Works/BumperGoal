import { PerspectiveCamera, Vector3 } from 'three';
import type { Page } from '@playwright/test';
import { arenaPosition } from '../src/game/arena3dProjection';
import { fitArenaCamera } from '../src/game/arenaCamera';

export async function boardToPage(page: Page, x: number, y: number, orientation = 1) {
  const box = (await page.locator('[data-testid=game-host] canvas').boundingBox())!;
  const camera = new PerspectiveCamera(34, 1, 0.1, 180);
  fitArenaCamera(camera, box.width, box.height);
  const point = arenaPosition(x, y, orientation);
  const p = new Vector3(point.x, 0, point.z).project(camera);
  return { x: box.x + ((p.x + 1) / 2) * box.width, y: box.y + ((1 - p.y) / 2) * box.height };
}
