import { describe, expect, it } from 'vitest';
import { TireMarks } from '../src/game/tireMarks';

function track(speed: number, accelerate = false) {
  const tracks = new TireMarks();
  tracks.sample(1, 0, 0, 0, 10);
  tracks.sample(1, speed * 0.02, 0, 20, 10);
  tracks.sample(1, speed * (accelerate ? 0.06 : 0.04), 0, 40, 10);
  return tracks;
}

describe('tire marks', () => {
  it('makes faster movement and acceleration leave darker tracks', () => {
    expect(track(500).marks.at(-1)!.alpha).toBeGreaterThan(track(100).marks.at(-1)!.alpha);
    expect(track(100, true).marks.at(-1)!.alpha).toBeGreaterThan(track(100).marks.at(-1)!.alpha);
  });

  it('keeps two wheel offsets perpendicular to travel and ignores stationary cars', () => {
    expect(track(0).marks).toHaveLength(0);
    const mark = track(100).marks[0]!;
    expect(mark.offsetX).toBeCloseTo(0);
    expect(mark.offsetY).toBe(10);
  });

  it('does not connect separate shots or position corrections', () => {
    const tracks = track(100);
    const count = tracks.marks.length;
    tracks.resetMotion();
    tracks.sample(1, 1000, 1000, 60, 10);
    tracks.sample(1, 0, 0, 80, 10);
    expect(tracks.marks).toHaveLength(count);
    tracks.prune(13000);
    expect(tracks.marks).toHaveLength(0);
  });

  it('measures speed independently of render frame rate', () => {
    const marks = (dt: number) => {
      const tracks = new TireMarks();
      for (let i = 0; i <= 5; i++) tracks.sample(1, (200 * (i * dt)) / 1000, 0, i * dt, 10);
      return tracks.marks.at(-1)!.alpha;
    };
    expect(marks(16)).toBeCloseTo(marks(33));
  });
});
