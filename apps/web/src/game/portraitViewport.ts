import { physicsConfig } from '@flickkick/config';
import { goalArt } from './art';
import { BOARD } from './theme';

/** Portrait camera bounds include both complete goal nets, without moving the goals. */
export function portraitViewport(width: number, height: number, resolution = 1) {
  const arena = physicsConfig.arena;
  const goal = goalArt();
  const netDepth = goal
    ? (goal.w / goal.h) * 2 * arena.goalHalfWidth * BOARD.pxPerUnit
    : arena.goalDepth * BOARD.pxPerUnit;
  const minimumHeight = 2 * (arena.halfWidth * BOARD.pxPerUnit + netDepth) + 16;
  return {
    width: BOARD.height * resolution,
    height: Math.ceil(Math.max(minimumHeight, (BOARD.height * height) / Math.max(1, width))) * resolution,
  };
}
