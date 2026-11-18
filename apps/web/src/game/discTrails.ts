/** Visual samples only: never writes physics state, hashes or controller data. */
export interface TrailSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  alpha: number;
  progress: number;
}
interface Point {
  x: number;
  y: number;
  time: number;
}
export class DiscTrailBuffer {
  private points: Point[] = [];
  clear() {
    this.points = [];
  }
  /** Pass a reusable output array for frame rendering; omitted outputs remain independent snapshots. */
  sample(x: number, y: number, time: number, segments: TrailSegment[] = []): TrailSegment[] {
    const last = this.points[0];
    let count = 0;
    if (!last) {
      this.points.length = 1;
      this.points[0] = { x, y, time };
      segments.length = 0;
      return segments;
    }
    const dt = time - last.time;
    if (dt <= 0) {
      segments.length = 0;
      return segments;
    }
    const distance = Math.hypot(x - last.x, y - last.y);
    const speed = (distance / dt) * 1000;
    if (dt > 120 || distance > 150 || speed < 14) {
      last.x = x;
      last.y = y;
      last.time = time;
      this.points.length = 1;
      segments.length = 0;
      return segments;
    }
    // Keep the newest 39 samples in place, reusing an expired sample when possible.
    let retained = 0;
    while (retained < this.points.length && retained < 39 && time - this.points[retained]!.time < 450) retained++;
    const current = this.points[retained] ?? { x, y, time };
    current.x = x;
    current.y = y;
    current.time = time;
    for (let i = retained; i > 0; i--) this.points[i] = this.points[i - 1]!;
    this.points[0] = current;
    this.points.length = retained + 1;
    const length = Math.min(220, 36 + speed * 0.35);
    // The leading sample stays at the disc center; its sprite covers the head.
    let travelled = 0;
    for (let i = 1; i < this.points.length && travelled < length; i++) {
      const a = this.points[i - 1]!,
        b = this.points[i]!;
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      if (d < 0.01) continue;
      const used = Math.min(d, length - travelled),
        fraction = used / d;
      const progress = Math.min(1, (travelled + used * 0.5) / length);
      const segment = segments[count] ?? (segments[count] = {} as TrailSegment);
      segment.x1 = a.x;
      segment.y1 = a.y;
      segment.x2 = a.x + (b.x - a.x) * fraction;
      segment.y2 = a.y + (b.y - a.y) * fraction;
      segment.width = Math.max(1.2, 28 * (1 - progress));
      segment.alpha = (1 - progress) * 0.95;
      segment.progress = progress;
      count++;
      travelled += used;
    }
    segments.length = count;
    return segments;
  }
}

/** Sync may arrive after scene creation; an explicit empty string disables a trail. */
export function activeTrailId(
  side: 'L' | 'R',
  live?: Partial<Record<'L' | 'R', string>>,
  initial?: Partial<Record<'L' | 'R', string>>,
) {
  return live?.[side] ?? initial?.[side];
}
