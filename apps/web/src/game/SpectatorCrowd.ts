import type Phaser from 'phaser';
import { crowdLayout } from './crowdLayout';
import type { Side } from '@flickkick/rules';
const TEXTURE = 'crowd-fans';
/** Upper-body regions keep faces and raised arms readable in the narrow stands. */
const FRAMES = [
  [0, 70, 345, 440],
  [345, 70, 285, 440],
  [630, 70, 312, 440],
  [942, 70, 312, 440],
  [0, 630, 340, 440],
  [340, 630, 300, 440],
  [640, 630, 294, 440],
  [934, 630, 320, 440],
];
export class SpectatorCrowd {
  private fans: { sprite: Phaser.GameObjects.Image; seat: ReturnType<typeof crowdLayout>[number] }[] = [];
  private cheerUntil = 0;
  private rotation: number;
  constructor(scene: Phaser.Scene, bottomSide: Side = 'L', lowQuality = false) {
    this.rotation = bottomSide === 'R' ? -Math.PI / 2 : Math.PI / 2;
    if (!scene.textures.exists(TEXTURE)) return;
    const texture = scene.textures.get(TEXTURE);
    FRAMES.forEach(([x, y, w, h], i) => {
      if (!texture.has(String(i))) texture.add(String(i), 0, x!, y!, w!, h!);
    });
    for (const seat of crowdLayout(lowQuality)) {
      const sprite = scene.add
        .image(seat.x, seat.y, TEXTURE, String(seat.frame))
        .setScale(seat.scale)
        .setRotation(this.rotation)
        .setDepth(4 + (bottomSide === 'R' ? seat.order : -seat.order) * 0.001);
      this.fans.push({ sprite, seat });
    }
  }
  cheer(now: number) {
    this.cheerUntil = now + 2600;
  }
  update(now: number, reducedMotion: boolean) {
    const excited = now < this.cheerUntil;
    for (const { sprite, seat } of this.fans) {
      const wave = reducedMotion ? 0 : Math.sin(now * (excited ? 0.014 : 0.005) + seat.phase);
      sprite.setPosition(seat.x + wave * (excited ? 6 : 2), seat.y);
      sprite.setRotation(this.rotation + wave * (excited ? 0.075 : 0.025));
      sprite.setScale(seat.scale * (1 + wave * (excited ? 0.025 : 0.012)));
    }
  }
  destroy() {
    for (const fan of this.fans) fan.sprite.destroy();
    this.fans = [];
  }
}
