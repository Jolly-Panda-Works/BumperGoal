// Anime-style match effects: charge aura, focus (speed) lines, impact stars,
// shockwaves, ball streak, goal slam text. Pure presentation: nothing here
// touches game state. All effects are skipped or toned down by the caller for
// reduced motion and the low graphics setting.
import Phaser from 'phaser';
import { BOARD } from './theme';

const W = BOARD.width;
const H = BOARD.height;

export interface Pt {
  x: number;
  y: number;
}

export class AnimeFx {
  private streak: Phaser.GameObjects.Graphics;
  private auraPoints = Array.from({ length: 36 }, () => new Phaser.Math.Vector2());
  private streakPoints: (Pt & { t: number })[] = [];

  constructor(private scene: Phaser.Scene) {
    this.streak = scene.add.graphics().setDepth(8).setBlendMode(Phaser.BlendModes.ADD);
  }

  /** Aura around the aimed disc: jagged ring and inward speed lines that grow with power. */
  chargeAura(g: Phaser.GameObjects.Graphics, origin: Pt, radius: number, power: number, color: number, now: number) {
    if (power < 0.35) return;
    const k = (power - 0.35) / 0.65;
    const spikes = 18;
    const pts = this.auraPoints;
    for (let i = 0; i < spikes * 2; i++) {
      const a = (i / (spikes * 2)) * Math.PI * 2 + now / 400;
      const jitter = Math.sin(now / 45 + i * 1.7) * 3;
      const r = radius + 8 + (i % 2 ? 4 : 10 + 14 * k) + jitter * k;
      pts[i]!.set(origin.x + Math.cos(a) * r, origin.y + Math.sin(a) * r);
    }
    g.fillStyle(color, 0.18 + 0.25 * k).fillPoints(pts, true);
    g.lineStyle(2, 0xffffff, 0.35 + 0.4 * k).strokePoints(pts, true);
    // Inward speed lines.
    const lines = Math.round(6 + 10 * k);
    for (let i = 0; i < lines; i++) {
      const a = ((i * 137.5 + now / 6) % 360) * (Math.PI / 180);
      const r0 = radius + 40 + ((now / 3 + i * 23) % 50);
      const r1 = r0 - 18 - 20 * k;
      g.lineStyle(2, 0xffffff, 0.25 + 0.45 * k);
      g.lineBetween(
        origin.x + Math.cos(a) * r0,
        origin.y + Math.sin(a) * r0,
        origin.x + Math.cos(a) * r1,
        origin.y + Math.sin(a) * r1,
      );
    }
  }

  /** Full-board radial speed lines converging on a point (manga "focus lines"). */
  focusLines(center: Pt, duration = 380, alpha = 0.55): void {
    const g = this.scene.add.graphics().setDepth(25);
    const count = 64;
    const reach = Math.hypot(W, H);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.05;
      const inner = 150 + Math.random() * 180;
      const width = 0.012 + Math.random() * 0.02;
      g.fillStyle(0xffffff, alpha * (0.5 + Math.random() * 0.5));
      g.fillTriangle(
        center.x + Math.cos(a) * inner,
        center.y + Math.sin(a) * inner,
        center.x + Math.cos(a - width) * reach,
        center.y + Math.sin(a - width) * reach,
        center.x + Math.cos(a + width) * reach,
        center.y + Math.sin(a + width) * reach,
      );
    }
    this.scene.tweens.add({ targets: g, alpha: 0, duration, ease: 'Quad.easeIn', onComplete: () => g.destroy() });
  }

  /** Spiky comic impact star with a white core. */
  impactStar(p: Pt, size: number, color = 0xffe14d): void {
    const g = this.scene.add.graphics({ x: p.x, y: p.y }).setDepth(16);
    const spikes = 9 + Math.round(Math.random() * 3);
    const outer: Phaser.Math.Vector2[] = [];
    const inner: Phaser.Math.Vector2[] = [];
    for (let i = 0; i < spikes * 2; i++) {
      const a = (i / (spikes * 2)) * Math.PI * 2 + Math.random() * 0.15;
      const r = i % 2 ? size * 0.42 : size * (0.85 + Math.random() * 0.3);
      outer.push(new Phaser.Math.Vector2(Math.cos(a) * r, Math.sin(a) * r));
      inner.push(new Phaser.Math.Vector2(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55));
    }
    g.fillStyle(0x111111, 0.9).fillPoints(
      outer.map((v) => v.clone().scale(1.12)),
      true,
    );
    g.fillStyle(color).fillPoints(outer, true);
    g.fillStyle(0xffffff).fillPoints(inner, true);
    g.setScale(0.3).setAngle(Math.random() * 360);
    this.scene.tweens.add({
      targets: g,
      scale: 1,
      duration: 70,
      ease: 'Back.easeOut',
      onComplete: () =>
        this.scene.tweens.add({ targets: g, alpha: 0, scale: 1.25, duration: 160, onComplete: () => g.destroy() }),
    });
  }

  /** Expanding ring. */
  shockwave(p: Pt, radius: number, color = 0xffffff, width = 6): void {
    const ring = this.scene.add.circle(p.x, p.y, radius, 0, 0).setStrokeStyle(width, color, 0.9).setDepth(15);
    this.scene.tweens.add({
      targets: ring,
      scale: 3.2,
      alpha: 0,
      duration: 320,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });
  }

  /** Short directional speed lines behind a shot. */
  shotLines(p: Pt, angle: number, power: number, color: number): void {
    const g = this.scene.add.graphics().setDepth(14);
    const back = angle + Math.PI;
    const n = Math.round(5 + 9 * power);
    for (let i = 0; i < n; i++) {
      const off = (Math.random() - 0.5) * 60;
      const nx = -Math.sin(back);
      const ny = Math.cos(back);
      const start = 30 + Math.random() * 20;
      const len = 60 + Math.random() * 120 * power;
      const sx = p.x + Math.cos(back) * start + nx * off;
      const sy = p.y + Math.sin(back) * start + ny * off;
      g.lineStyle(2 + Math.random() * 3, i % 3 === 0 ? color : 0xffffff, 0.8);
      g.lineBetween(sx, sy, sx + Math.cos(back) * len, sy + Math.sin(back) * len);
    }
    this.scene.tweens.add({ targets: g, alpha: 0, duration: 260, onComplete: () => g.destroy() });
  }

  /** Full-screen flash. */
  flash(color = 0xffffff, alpha = 0.7, duration = 160): void {
    const r = this.scene.add.rectangle(W / 2, H / 2, W * 2, H * 2, color, alpha).setDepth(40);
    this.scene.tweens.add({ targets: r, alpha: 0, duration, onComplete: () => r.destroy() });
  }

  /** Tapered glowing streak behind the ball; turns into a fiery comet when fast. */
  ballStreak(p: Pt | null, now: number, radius: number): void {
    if (p) this.streakPoints.push({ ...p, t: now });
    while (this.streakPoints.length && now - this.streakPoints[0]!.t > 160) this.streakPoints.shift();
    const g = this.streak.clear();
    const pts = this.streakPoints;
    if (pts.length < 2) return;
    const head = pts[pts.length - 1]!;
    const tail = pts[0]!;
    const speed = Math.hypot(head.x - tail.x, head.y - tail.y) / Math.max(16, head.t - tail.t);
    if (speed < 0.25) return;
    const hot = Math.min(1, (speed - 0.25) / 1.1);
    const color = Phaser.Display.Color.Interpolate.ColorWithColor(
      Phaser.Display.Color.ValueToColor(0x9be7ff),
      Phaser.Display.Color.ValueToColor(0xff7a1a),
      100,
      Math.round(hot * 100),
    );
    const c = Phaser.Display.Color.GetColor(color.r, color.g, color.b);
    for (let i = 1; i < pts.length; i++) {
      const k = i / pts.length;
      const a = pts[i - 1]!;
      const b = pts[i]!;
      g.lineStyle(radius * 2 * k * (0.7 + hot * 0.5), c, 0.12 + 0.5 * k);
      g.lineBetween(a.x, a.y, b.x, b.y);
    }
    if (hot > 0.5) {
      g.fillStyle(0xffd27a, 0.5 * hot).fillCircle(head.x, head.y, radius * (1.4 + Math.random() * 0.4));
    }
  }

  clearStreak(): void {
    this.streakPoints = [];
    this.streak.clear();
  }

  /** "GOAL!" slam: sunburst in the scorer's colour, outlined text, bounce in. */
  goalSlam(text: string, color: number, fontFamily: string, plateKey?: string, viewAngle = 0): void {
    const s = this.scene;
    const cx = W / 2;
    const cy = H / 2;
    const rays = s.add.graphics({ x: cx, y: cy }).setDepth(31);
    const n = 20;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = a0 + Math.PI / n;
      rays.fillStyle(i % 2 ? color : 0xffffff, i % 2 ? 0.55 : 0.25);
      rays.fillTriangle(0, 0, Math.cos(a0) * 900, Math.sin(a0) * 900, Math.cos(a1) * 900, Math.sin(a1) * 900);
    }
    rays.setScale(0.2).setAlpha(0);
    s.tweens.add({ targets: rays, scale: 1, alpha: 1, duration: 220, ease: 'Cubic.easeOut' });
    s.tweens.add({ targets: rays, angle: 25, duration: 1400 });

    const label = s.add
      .text(cx, cy, text, {
        fontFamily,
        fontSize: '100px',
        fontStyle: '900',
        color: '#ffe14d',
        stroke: '#111111',
        strokeThickness: 18,
        shadow: { offsetX: 8, offsetY: 10, color: '#000000', blur: 0, fill: true, stroke: true },
        padding: { x: 24, y: 24 },
      })
      .setOrigin(0.5)
      .setDepth(32.5)
      .setScale(3)
      .setAngle(viewAngle - 8)
      .setAlpha(0);
    // Banner plate behind the text (art), sized to the text.
    const plate =
      plateKey && s.textures.exists(plateKey)
        ? s.add
            .image(cx, cy + 6, plateKey)
            .setDepth(32)
            .setAlpha(0)
            .setAngle(viewAngle - 4)
        : null;
    if (plate) {
      const width = label.width * 1.35;
      plate.setDisplaySize(width, (width * plate.height) / plate.width);
      const full = { x: plate.scaleX, y: plate.scaleY };
      plate.setScale(full.x * 0.2, full.y * 0.2);
      s.tweens.add({ targets: plate, scaleX: full.x, scaleY: full.y, alpha: 1, duration: 240, ease: 'Back.easeOut' });
    }
    s.tweens.add({ targets: label, scale: 1, alpha: 1, angle: viewAngle - 4, duration: 260, ease: 'Back.easeOut' });
    s.tweens.add({
      targets: label,
      scale: 1.06,
      duration: 160,
      yoyo: true,
      repeat: 2,
      delay: 260,
      ease: 'Sine.easeInOut',
    });
    s.tweens.add({
      targets: plate ? [label, rays, plate] : [label, rays],
      alpha: 0,
      delay: 2450,
      duration: 260,
      onComplete: () => {
        label.destroy();
        rays.destroy();
        plate?.destroy();
      },
    });
  }

  destroy(): void {
    this.streak.destroy();
  }
}
