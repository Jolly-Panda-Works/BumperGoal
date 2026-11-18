interface Sample {
  x: number;
  y: number;
  time: number;
  vx: number;
  vy: number;
}

export interface TireMark {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  offsetX: number;
  offsetY: number;
  alpha: number;
  width: number;
  time: number;
}

/** Presentation-only tire tracks, measured in board pixels and seconds. */
export class TireMarks {
  readonly marks: TireMark[] = [];
  private samples = new Map<number, Sample>();
  static readonly lifetime = 12000;
  static readonly limit = 1600;

  resetMotion(): void {
    this.samples.clear();
  }

  clear(): void {
    this.resetMotion();
    this.marks.length = 0;
  }

  sample(index: number, x: number, y: number, time: number, wheelOffset: number): void {
    const last = this.samples.get(index);
    if (!last) {
      this.samples.set(index, { x, y, time, vx: 0, vy: 0 });
      return;
    }
    const dt = (time - last.time) / 1000;
    if (dt <= 0) return;
    const dx = x - last.x;
    const dy = y - last.y;
    const distance = Math.hypot(dx, dy);
    const vx = dx / dt;
    const vy = dy / dt;
    // Ignore pause gaps and kickoff/server corrections rather than drawing across the pitch.
    if (dt > 0.12 || distance > 100) {
      this.samples.set(index, { x, y, time, vx: 0, vy: 0 });
      return;
    }
    const speed = distance / dt;
    const acceleration = Math.hypot(vx - last.vx, vy - last.vy) / dt;
    this.samples.set(index, { x, y, time, vx, vy });
    if (speed < 35 || distance < 0.35) return;
    const load = Math.min(1, speed / 650) * 0.5 + Math.min(1, acceleration / 3500) * 0.5;
    this.marks.push({
      x1: last.x,
      y1: last.y,
      x2: x,
      y2: y,
      offsetX: (-dy / distance) * wheelOffset,
      offsetY: (dx / distance) * wheelOffset,
      alpha: 0.08 + load * 0.48,
      width: 2 + load * 1.7,
      time,
    });
    if (this.marks.length > TireMarks.limit) this.marks.splice(0, this.marks.length - TireMarks.limit);
  }

  prune(time: number): void {
    const firstLive = this.marks.findIndex((mark) => time - mark.time < TireMarks.lifetime);
    if (firstLive === -1) this.marks.length = 0;
    else if (firstLive > 0) this.marks.splice(0, firstLive);
  }
}
