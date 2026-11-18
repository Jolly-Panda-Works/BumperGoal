import { expect, it } from 'vitest';
import { portraitViewport } from '../src/game/portraitViewport';
import { physicsConfig } from '@flickkick/config';
import { goalArt } from '../src/game/art';
import { BOARD } from '../src/game/theme';
it('keeps both goal nets outside the pitch and inside the portrait camera at short phone sizes', () => {
  const goal = goalArt()!;
  const fullSpan =
    2 *
    (physicsConfig.arena.halfWidth * BOARD.pxPerUnit +
      (goal.w / goal.h) * 2 * physicsConfig.arena.goalHalfWidth * BOARD.pxPerUnit);
  for (const [w, h] of [
    [342, 537],
    [393, 788],
    [320, 450],
  ]) {
    const view = portraitViewport(w!, h!, 2);
    expect(view.height / 2).toBeGreaterThan(fullSpan + 15);
    expect(view.width).toBe(BOARD.height * 2);
  }
});
