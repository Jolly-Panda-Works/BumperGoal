import { expect, it } from 'vitest';
import { physicsConfig } from '@flickkick/config';
import { BOARD } from '../src/game/theme';
import { crowdLayout } from '../src/game/crowdLayout';
it('places cheering fans outside both touchlines with room for their full movement', () => {
  const top = BOARD.height / 2 - physicsConfig.arena.halfHeight * BOARD.pxPerUnit,
    bottom = BOARD.height - top;
  const seats = crowdLayout();
  expect(seats).toHaveLength(36);
  expect(crowdLayout(true)).toHaveLength(24);
  for (const seat of seats) {
    const extent = ((345 * Math.cos(0.075) + 440 * Math.sin(0.075)) / 2) * seat.scale * 1.025;
    expect(seat.y < top ? seat.y + extent < top : seat.y - extent > bottom).toBe(true);
    expect(seat.frame).toBeGreaterThanOrEqual(0);
    expect(seat.frame).toBeLessThan(8);
  }
  expect(new Set(seats.map((s) => s.frame)).size).toBe(8);
});
