import { physicsConfig } from '@flickkick/config';
import { BOARD } from './theme';
export function crowdLayout(lowQuality = false) {
  const count = lowQuality ? 12 : 18;
  const x0 = BOARD.width / 2 - physicsConfig.arena.halfWidth * BOARD.pxPerUnit + 60;
  const x1 = BOARD.width - x0;
  const margin = (BOARD.height - physicsConfig.arena.halfHeight * BOARD.pxPerUnit * 2) / 2;
  return [0, 1].flatMap((side) =>
    Array.from({ length: count }, (_, i) => ({
      x: x0 + ((x1 - x0) * i) / (count - 1),
      y: side === 0 ? margin / 2 : BOARD.height - margin / 2,
      frame: (i * 3 + side * 5) % 8,
      phase: i * 0.83 + side * 1.71,
      scale: 0.145 * (0.98 + (i % 3) * 0.025),
      order: i,
    })),
  );
}
