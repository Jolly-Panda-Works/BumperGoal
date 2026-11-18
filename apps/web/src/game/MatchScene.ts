// Phaser render + input layer over the Koota match world.
// Each frame: playback → sync → ease → highlight systems, then render from
// ECS traits. Phaser never owns game state; the controller owns the rules.
import Phaser from 'phaser';
import type { Entity } from 'koota';
import { physicsConfig, teamAimRange, teamPhysics, type TeamDef } from '@flickkick/config';
import type { MatchEvent, Side } from '@flickkick/rules';
import i18n from '../i18n';
import { audio } from '../services/audio';
import { settingsStore } from '../services/settings';
import type { MatchDriver } from './driver';
import { bodyEntities, clearAiming, runFrame, type Impact } from './ecs/systems';
import { Aiming, BodyRef, Highlighted, HoldTrait, IsBall, PlaybackTrait, Position, Team, View } from './ecs/traits';
import { ART_SCALE, assetUrl, ballTextureKey, ballUrl, ballRollArt, ballShadeArt, goalArt, themeArt } from './art';
import { SpectatorCrowd } from './SpectatorCrowd';
import { TireMarks } from './tireMarks';
import { AnimeFx } from './fx';
import type { ShotPlayback } from './MatchController';
import { BOARD, ballDef, hex, resolveTeams } from './theme';

export const SCENE_KEY = 'match';

export interface SceneInit {
  controller: MatchDriver;
  ballId: string;
  trailIds?: Partial<Record<Side, string>>;
  /** Board art theme (arena theme online, the default theme offline). */
  theme: string;
  /** Presentation only: this side is shown at the bottom of the portrait pitch. */
  bottomSide?: Side;
  onInvalidPress?: (reason: 'not_your_disc' | 'not_your_turn') => void;
  /** Shakes the page around the board (0..1); the React side owns the DOM. */
  onScreenShake?: (strength: number) => void;
}

const S = BOARD.pxPerUnit;
const CX = BOARD.width / 2;
const CY = BOARD.height / 2;
const MAX_DRAG_PX = 170;
const MIN_DRAG_PX = 14;
const GOAL_HOLD_MS = 1100;
/** Power threshold for stronger shot haptics. */
const POWER_SHOT = 0.75;
const CAR_MODELS = ['cicada', 'cruiser', 'carrier'] as const;
const TEAM_CARS = ['cicada', 'cruiser'] as const;
const CAR_SIZE = 3.25;

const toPx = (x: number, y: number) => ({ x: CX + x * S, y: CY - y * S });

interface BodyView {
  sprite: Phaser.GameObjects.Container;
  shadow: Phaser.GameObjects.Ellipse;
  /** Ball only: the rolling strip (rotated to the travel direction) and its state. */
  roll?: { strip: Phaser.GameObjects.Sprite; frames: number; phase: number; last: { x: number; y: number } };
}

export class MatchScene extends Phaser.Scene {
  private setup!: SceneInit;
  private entities: Entity[] = [];
  private trailGraphics!: Phaser.GameObjects.Graphics;
  private tireMarks = new TireMarks();
  private rings!: Phaser.GameObjects.Graphics;
  private aim!: Phaser.GameObjects.Graphics;
  private fx!: AnimeFx;
  private crowd?: SpectatorCrowd;
  private lastAim: { origin: { x: number; y: number }; at: { x: number; y: number } } | null = null;
  /** Playback frame for the near-miss crowd audio. */
  private nearMissFrame = -1;
  private matchMusic = false;
  private unsubscribers: (() => void)[] = [];
  private teams!: [TeamDef, TeamDef];
  private lastSfxAt = 0;

  constructor() {
    super(SCENE_KEY);
  }

  private get world() {
    return this.setup.controller.world;
  }

  init(data: SceneInit): void {
    this.setup = data;
    const players = data.controller.current.players;
    this.teams = resolveTeams(players[0].teamId, players[1].teamId);
  }

  /** Loads the theme's board art; any file that fails keeps its procedural placeholder. */
  preload(): void {
    const theme = themeArt(this.setup.theme);
    const load = (key: string, file: string | undefined) => {
      if (file && !this.textures.exists(key)) this.load.image(key, assetUrl(file));
    };
    if (theme) {
      load(`bg-${this.setup.theme}`, theme.bg.file);
      load(`turf-${this.setup.theme}`, theme.turf.file);
      load(`frame-${this.setup.theme}`, theme.frame.file);
    }
    load('crowd-fans', 'crowd/fans-atlas.png');
    load(`goal-${this.setup.theme}`, goalArt(this.setup.theme)?.file);
    for (const model of CAR_MODELS) {
      load(`car-${model}`, `cars/${model}.png`);
    }
    const ballKey = ballTextureKey(this.setup.ballId);
    const ballSrc = ballUrl(this.setup.ballId);
    if (ballSrc && !this.textures.exists(ballKey)) this.load.image(ballKey, ballSrc);
    // An uploaded ball is drawn as a still image: the bundled rolling strip would not match it.
    const uploadedBall = ballKey !== `ball-art-${this.setup.ballId}`;
    const roll = uploadedBall ? undefined : ballRollArt(this.setup.ballId);
    if (roll && !this.textures.exists(`ball-roll-${this.setup.ballId}`)) {
      this.load.spritesheet(`ball-roll-${this.setup.ballId}`, assetUrl(roll.file), {
        frameWidth: roll.frame,
        frameHeight: roll.frame,
      });
    }
    load('ball-shade', ballShadeArt()?.file);
    load('banner-goal', 'ui/banner_goal.webp');
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      console.warn(`art missing: ${file.src}; using the placeholder`);
    });
  }

  create(): void {
    this.layoutCamera();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layoutCamera, this);

    this.drawPitch();
    this.crowd = new SpectatorCrowd(this, this.setup.bottomSide, settingsStore.get().graphics === 'low');
    this.makeTextures();
    this.fx = new AnimeFx(this);
    this.trailGraphics = this.add.graphics().setDepth(8);
    this.rings = this.add.graphics().setDepth(9);
    this.createViews();
    this.aim = this.add.graphics().setDepth(20);

    this.input.on('pointerdown', this.onPointerDown, this);
    this.input.on('pointermove', this.onPointerMove, this);
    this.input.on('pointerup', this.onPointerUp, this);
    this.input.on('pointerupoutside', this.onPointerUp, this);

    const c = this.setup.controller;
    this.unsubscribers.push(
      c.bus.on('playShot', (p) => this.onPlayShot(p)),
      c.bus.on('events', (events) => this.onEvents(events)),
    );
    audio.startCrowd();
    // Walk-on intro; the match music takes over when it ends or play starts.
    audio.playSting('intro', 0.9, () => this.startMatchMusic());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.cleanup());
    this.render();
  }

  private layoutCamera(): void {
    this.cameras.main
      .setZoom(this.scale.width / BOARD.height)
      .setRotation(this.setup.bottomSide === 'R' ? Math.PI / 2 : -Math.PI / 2)
      .centerOn(CX, CY);
  }

  private cleanup(): void {
    this.scale.off(Phaser.Scale.Events.RESIZE, this.layoutCamera, this);
    this.unsubscribers.forEach((u) => u());
    this.unsubscribers = [];
    this.input.removeAllListeners();
    audio.stopCrowd();
    audio.duckStings(0);
    this.fx?.destroy();
    this.crowd?.destroy();
    this.crowd = undefined;
    this.tireMarks.clear();
  }

  /** Advances the ball's rolling strip by the distance it moved this frame. */
  private rollBall(roll: NonNullable<BodyView['roll']>, p: { x: number; y: number }): void {
    const dx = p.x - roll.last.x;
    const dy = p.y - roll.last.y;
    roll.last = { x: p.x, y: p.y };
    const dist = Math.hypot(dx, dy);
    if (dist < 0.05 || dist > 200) return; // at rest, or a reset jump (kickoff)
    roll.strip.rotation = Math.atan2(dy, dx);
    // One full turn of the strip = one circumference travelled.
    roll.phase += (dist / (Math.PI * physicsConfig.ball.radius * S * 2)) * roll.frames;
    roll.strip.setFrame(Math.floor(roll.phase) % roll.frames);
  }

  /** Match music sits under the crowd; the walk-on intro fades out for it. */
  private startMatchMusic(): void {
    if (this.matchMusic || !this.sys?.isActive()) return;
    this.matchMusic = true;
    audio.duckStings(0);
    audio.playMusic('match', 0.4);
  }

  /** Effects are full on high graphics, minimal on low, and off with reduced motion. */
  private get fxLevel(): 'full' | 'lite' | 'off' {
    const s = settingsStore.get();
    if (s.reducedMotion) return 'off';
    return s.graphics === 'high' ? 'full' : 'lite';
  }

  private shake(strength: number): void {
    if (this.fxLevel === 'off') return;
    this.cameras.main.shake(120 + strength * 240, 0.002 + strength * 0.008);
    this.setup.onScreenShake?.(strength);
  }

  private onPlayShot(p: ShotPlayback): void {
    this.aim.clear();
    this.lastAim = null;
    clearAiming(this.world);
    this.fx.clearStreak();
    this.analyseShot(p);
    const power = Math.min(
      1,
      Math.hypot(p.shot.ix, p.shot.iy) /
        teamPhysics(this.setup.controller.playerOf(p.side).teamId, physicsConfig).maxImpulse,
    );
    audio.play('kick', power);
    this.startMatchMusic();
    audio.vibrate(power >= POWER_SHOT ? [20, 30, 40] : 15);
    audio.excite(0.2 + power * 0.35, 0.4);
  }

  /** Finds near misses for crowd audio without changing playback speed. */
  private analyseShot(p: ShotPlayback): void {
    this.nearMissFrame = -1;
    const ball = this.entities.findIndex((e) => e?.has(IsBall));
    if (ball < 0) return;
    const a = physicsConfig.arena;
    const scored = p.result.outcome === 'goal_left' || p.result.outcome === 'goal_right';
    let closest = Infinity;
    for (let f = 0; f <= p.ticks; f++) {
      const x = p.frames[(f * p.bodyCount + ball) * 2]!;
      const y = p.frames[(f * p.bodyCount + ball) * 2 + 1]!;
      if (scored && Math.abs(x) > a.halfWidth && Math.abs(y) < a.goalHalfWidth) {
        return;
      }
      // Near miss: the ball reaches the end wall just beside the mouth.
      const gap = Math.abs(y) - a.goalHalfWidth;
      if (!scored && Math.abs(x) > a.halfWidth - 0.45 && gap > 0 && gap < 0.6 && gap < closest) {
        closest = gap;
        this.nearMissFrame = f;
      }
    }
  }

  // ---------- frame ----------
  override update(_time: number, delta: number): void {
    const pb = this.world.get(PlaybackTrait);
    if (pb?.active && this.nearMissFrame >= 0 && pb.elapsedMs / (1000 / 60) >= this.nearMissFrame) {
      this.nearMissFrame = -1;
      audio.play('oh');
      audio.excite(0.7, 0.8);
    }
    runFrame(this.world, {
      deltaMs: delta,
      nowMs: this.time.now,
      reducedMotion: settingsStore.get().reducedMotion,
      onImpact: (impact) => this.onImpact(impact),
      onShotFinished: () => {
        this.fx.clearStreak();
        this.nearMissFrame = -1;
        this.setup.controller.completeShot();
      },
    });
    this.crowd?.update(this.time.now, settingsStore.get().reducedMotion);
    this.render();
  }

  private render(): void {
    const playing = this.world.get(PlaybackTrait)?.active ?? false;
    const streak = playing && this.fxLevel === 'full';
    this.trailGraphics.clear();
    if (!playing) this.tireMarks.resetMotion();
    for (const e of this.entities) {
      const pos = e.get(Position)!;
      const view = e.get(View) as BodyView;
      const p = toPx(pos.x, pos.y);
      if (playing && !e.has(IsBall)) {
        this.tireMarks.sample(e.get(BodyRef)!.index, p.x, p.y, this.time.now, physicsConfig.disc.radius * S * 0.62);
      }
      if (!e.has(IsBall)) {
        const dx = p.x - view.sprite.x;
        const dy = p.y - view.sprite.y;
        const aim = e.get(Aiming);
        const car = view.sprite.list[view.sprite.list.length - 1] as Phaser.GameObjects.Image;
        if (aim && aim.power > 0) car.setRotation(Math.PI / 2 - aim.angle);
        else if (playing && dx * dx + dy * dy > 0.04) car.setRotation(Math.atan2(dy, dx) + Math.PI / 2);
      }
      view.sprite.setPosition(p.x, p.y);
      view.shadow.setPosition(p.x + 4, p.y + 6);
      if (view.roll) this.rollBall(view.roll, p);
      if (streak && e.has(IsBall)) this.fx.ballStreak(p, this.time.now, physicsConfig.ball.radius * S);
    }
    this.drawTireMarks();
    this.drawRings();
    // The charge aura animates, so the aim is redrawn every frame while dragging.
    if (this.lastAim && this.aimingEntity()) this.redrawAim();
  }

  private drawTireMarks(): void {
    const now = this.time.now;
    this.tireMarks.prune(now);
    for (const mark of this.tireMarks.marks) {
      const fade = Math.min(1, (TireMarks.lifetime - (now - mark.time)) / 4000);
      this.trailGraphics.lineStyle(mark.width, 0x101813, mark.alpha * fade);
      for (const sign of [-1, 1]) {
        this.trailGraphics.lineBetween(
          mark.x1 + mark.offsetX * sign,
          mark.y1 + mark.offsetY * sign,
          mark.x2 + mark.offsetX * sign,
          mark.y2 + mark.offsetY * sign,
        );
      }
    }
  }

  // ---------- drawing ----------
  private drawPitch(): void {
    const a = physicsConfig.arena;
    const w = a.halfWidth * S;
    const h = a.halfHeight * S;
    const gd = a.goalDepth * S;
    const gh = a.goalHalfWidth * S;
    const theme = this.setup.theme;
    const has = (key: string) => this.textures.exists(key);
    const g = this.add.graphics();

    if (has(`bg-${theme}`)) {
      this.add.image(0, 0, `bg-${theme}`).setOrigin(0).setDisplaySize(BOARD.width, BOARD.height);
    } else {
      g.fillStyle(BOARD.background).fillRect(0, 0, BOARD.width, BOARD.height);
    }
    const art = themeArt(theme);
    const framed = art && has(`frame-${theme}`);
    if (!framed) {
      g.fillStyle(BOARD.wall).fillRoundedRect(CX - w - 18, CY - h - 18, 2 * w + 36, 2 * h + 36, 22);
      g.lineStyle(3, BOARD.wallEdge).strokeRoundedRect(CX - w - 18, CY - h - 18, 2 * w + 36, 2 * h + 36, 22);
    }
    if (has(`turf-${theme}`)) {
      // The turf runs on under the frame's inner lip, so no background shows
      // through its rounded inner corners. The insets also include the frame's
      // transparent outer margin, so only part of the border is used.
      const under = art && has(`frame-${theme}`) ? (Math.min(...Object.values(art.frame.insets)) / ART_SCALE) * 0.4 : 0;
      const l = under;
      const t = under;
      const r = under;
      const b = under;
      this.add
        .image(CX - w - l, CY - h - t, `turf-${theme}`)
        .setOrigin(0)
        .setDisplaySize(2 * w + l + r, 2 * h + t + b);
    } else {
      const stripes = 10;
      for (let i = 0; i < stripes; i++) {
        g.fillStyle(i % 2 ? BOARD.pitchDark : BOARD.pitchLight);
        g.fillRect(CX - w + (i * 2 * w) / stripes, CY - h, (2 * w) / stripes + 1, 2 * h);
      }
    }
    if (framed) this.drawFrame(`frame-${theme}`, art.frame, w, h);
    this.drawCornerCuts(framed ? `frame-${theme}` : null, w, h);

    // Markings sit on the turf, under the frame's inner lip.
    const m = this.add.graphics().setDepth(1);
    m.lineStyle(3, BOARD.line, 0.85);
    m.strokeRect(CX - w, CY - h, 2 * w, 2 * h);
    m.lineBetween(CX, CY - h, CX, CY + h);
    m.strokeCircle(CX, CY, 1.3 * S);
    m.fillStyle(BOARD.line).fillCircle(CX, CY, 4);
    for (const side of [-1, 1]) {
      const bx = side < 0 ? CX - w : CX + w - 2.2 * S;
      m.strokeRect(bx, CY - 2.4 * S, 2.2 * S, 4.8 * S);
      const sx = side < 0 ? CX - w : CX + w - 0.9 * S;
      m.strokeRect(sx, CY - 1.6 * S, 0.9 * S, 3.2 * S);
    }

    const goal = goalArt(theme);
    if (goal && has(`goal-${theme}`)) {
      // The whole goal sits behind the goal line: posts on the line, net over the pocket.
      const dh = 2 * gh;
      const dw = (goal.w / goal.h) * dh;
      for (const side of [-1, 1]) {
        this.add
          .image(side < 0 ? CX - w : CX + w, CY, `goal-${theme}`)
          .setOrigin(side < 0 ? 1 : 0, 0.5) // flipX mirrors the image, not its origin
          .setDisplaySize(dw, dh)
          .setFlipX(side > 0)
          .setDepth(3);
      }
    } else {
      const n = this.add.graphics().setDepth(3);
      for (const side of [-1, 1]) {
        const x0 = side < 0 ? CX - w - gd : CX + w;
        n.fillStyle(0x15204a).fillRect(x0, CY - gh, gd, 2 * gh);
        n.lineStyle(1, BOARD.net, 0.35);
        for (let x = x0; x <= x0 + gd; x += 9) n.lineBetween(x, CY - gh, x, CY + gh);
        for (let y = CY - gh; y <= CY + gh; y += 9) n.lineBetween(x0, y, x0 + gd, y);
        n.lineStyle(5, 0xffffff).strokeRect(x0, CY - gh, gd, 2 * gh);
      }
    }
    if (framed) return;
    // Placeholder only: side strips in team colours mark who defends which goal.
    const [l, r] = this.teams;
    const banners = this.add.graphics().setDepth(3);
    banners.fillStyle(hex(l.primary), 0.9).fillRoundedRect(CX - w - gd - 34, CY - h, 12, 2 * h, 6);
    banners.fillStyle(hex(r.primary), 0.9).fillRoundedRect(CX + w + gd + 22, CY - h, 12, 2 * h, 6);
  }

  private frameLayer?: Phaser.GameObjects.Container;

  /**
   * The physics cuts each pitch corner at 45° (arena.cornerChamfer). Fill the cut
   * with the frame's border colour and edge it with its inner lip colour.
   */
  private drawCornerCuts(frameKey: string | null, w: number, h: number): void {
    const c = physicsConfig.arena.cornerChamfer * S;
    let fill = BOARD.wall;
    let edge = BOARD.wallEdge;
    if (frameKey) {
      const frame = themeArt(this.setup.theme)!.frame;
      const src = this.textures.get(frameKey).getSourceImage() as HTMLImageElement;
      const mid = Math.round(src.width / 2);
      const pick = (y: number) => this.textures.getPixel(mid, y, frameKey, '__BASE');
      const border = pick(Math.round(frame.insets.top * 0.45));
      const lip = pick(frame.insets.top - 5);
      if (border) fill = border.color;
      if (lip) edge = lip.color;
    }
    const g = this.add.graphics().setDepth(2);
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const x = CX + sx * w;
        const y = CY + sy * h;
        const a = { x: x - sx * c, y };
        const b = { x, y: y - sy * c };
        g.fillStyle(fill).fillTriangle(x, y, a.x, a.y, b.x, b.y);
        g.lineStyle(4, edge).lineBetween(a.x, a.y, b.x, b.y);
      }
    }
  }

  /**
   * Draws the frame as eight slices around the pitch (renderer independent,
   * unlike Phaser's WebGL-only NineSlice). Insets are in texture px.
   */
  private drawFrame(
    key: string,
    frame: { w: number; h: number; insets: { left: number; top: number; right: number; bottom: number } },
    w: number,
    h: number,
  ): void {
    const tex = this.textures.get(key);
    const { left: l, top: t, right: r, bottom: b } = frame.insets;
    const mw = frame.w - l - r;
    const mh = frame.h - t - b;
    const k = 1 / ART_SCALE;
    const x0 = CX - w;
    const y0 = CY - h;
    const x1 = CX + w;
    const y1 = CY + h;
    // [name, source x, y, w, h, target x, y, w, h]
    const slices: [string, number, number, number, number, number, number, number, number][] = [
      ['tl', 0, 0, l, t, x0 - l * k, y0 - t * k, l * k, t * k],
      ['t', l, 0, mw, t, x0, y0 - t * k, 2 * w, t * k],
      ['tr', l + mw, 0, r, t, x1, y0 - t * k, r * k, t * k],
      ['l', 0, t, l, mh, x0 - l * k, y0, l * k, 2 * h],
      ['r', l + mw, t, r, mh, x1, y0, r * k, 2 * h],
      ['bl', 0, t + mh, l, b, x0 - l * k, y1, l * k, b * k],
      ['b', l, t + mh, mw, b, x0, y1, 2 * w, b * k],
      ['br', l + mw, t + mh, r, b, x1, y1, r * k, b * k],
    ];
    const parts = slices.map(([name, sx, sy, sw, sh, tx, ty, tw, th]) => {
      if (!tex.has(name)) tex.add(name, 0, sx, sy, sw, sh);
      return this.add.image(tx, ty, key, name).setOrigin(0).setDisplaySize(tw, th);
    });
    this.frameLayer = this.add.container(0, 0, parts).setDepth(2);
  }

  private makeTextures(): void {
    const discPx = Math.round(physicsConfig.disc.radius * S * 2);
    this.teams.forEach((team, i) => {
      const key = `disc-${i}-${team.id}`;
      if (this.textures.exists(key)) return;
      const size = discPx * 2; // 2x for crisp scaling
      const r = size / 2;
      const g = this.make.graphics({}, false);
      g.fillStyle(hex(team.secondary)).fillCircle(r, r, r);
      g.fillStyle(hex(team.primary)).fillCircle(r, r, r * 0.84);
      g.lineStyle(size * 0.04, 0x000000, 0.25).strokeCircle(r, r, r * 0.84);
      g.fillStyle(hex(team.secondary));
      drawEmblem(g, team.emblem, r, r, r * 0.42);
      g.generateTexture(key, size, size);
      g.destroy();
    });
    const ball = ballDef(this.setup.ballId);
    const ballKey = `ball-${ball.id}`;
    if (!this.textures.exists(ballKey) && !this.textures.exists(ballTextureKey(ball.id))) {
      const size = Math.round(physicsConfig.ball.radius * S * 4);
      const r = size / 2;
      const g = this.make.graphics({}, false);
      g.fillStyle(hex(ball.primary)).fillCircle(r, r, r);
      g.fillStyle(hex(ball.secondary));
      drawEmblem(g, 'pentagon', r, r, r * 0.36);
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
        g.fillCircle(r + Math.cos(a) * r * 0.78, r + Math.sin(a) * r * 0.78, r * 0.17);
      }
      g.lineStyle(size * 0.05, 0x000000, 0.35).strokeCircle(r, r, r - size * 0.025);
      g.generateTexture(ballKey, size, size);
      g.destroy();
    }
  }

  /** Attaches Phaser display objects to each body entity's View trait. */
  private createViews(): void {
    const ball = ballDef(this.setup.ballId);
    this.entities = bodyEntities(this.world);
    for (const e of this.entities) {
      const isBall = e.has(IsBall);
      const radius = (isBall ? physicsConfig.ball.radius : physicsConfig.disc.radius) * S;
      const shadow = this.add.ellipse(0, 0, radius * 2.1, radius * 1.6, 0x000000, 0.28).setDepth(9);
      const teamIndex = isBall ? 0 : e.get(Team)!.side === 'L' ? 0 : 1;
      const team = this.teams[teamIndex];
      const model = TEAM_CARS[teamIndex]!;
      const artKey = isBall ? ballTextureKey(ball.id) : `car-${model}`;
      const key = this.textures.exists(artKey) ? artKey : isBall ? `ball-${ball.id}` : `disc-${teamIndex}-${team.id}`;
      const rollKey = ballTextureKey(ball.id) === `ball-art-${ball.id}` ? `ball-roll-${ball.id}` : '';
      if (isBall && this.textures.exists(rollKey)) {
        // Rolling ball: the strip turns toward the travel direction and steps
        // frames by distance; the lighting overlay stays fixed (top-left light).
        const strip = this.add.sprite(0, 0, rollKey, 0).setDisplaySize(radius * 2, radius * 2);
        const parts: Phaser.GameObjects.GameObject[] = [strip];
        if (this.textures.exists('ball-shade')) {
          parts.push(this.add.image(0, 0, 'ball-shade').setDisplaySize(radius * 2, radius * 2));
        }
        const sprite = this.add.container(0, 0, parts).setDepth(11);
        const frames = this.textures.get(rollKey).frameTotal - 1; // minus __BASE
        const pos = e.get(Position)!;
        e.set(View, { sprite, shadow, roll: { strip, frames, phase: 0, last: toPx(pos.x, pos.y) } });
        continue;
      }
      const img = this.add
        .image(0, 0, key)
        .setDisplaySize(radius * (isBall ? 2 : CAR_SIZE), radius * (isBall ? 2 : CAR_SIZE));
      const parts: Phaser.GameObjects.GameObject[] = [];
      if (!isBall) {
        // Team identity stays visible beneath every car, independent of its paint.
        const badge = this.add.ellipse(0, 0, radius * 2.35, radius * 2.35, hex(team.primary), 0.2);
        badge.setStrokeStyle(2, hex(team.primary), 0.9);
        parts.push(badge);
        img.setRotation(teamIndex === 0 ? Math.PI / 2 : -Math.PI / 2);
      }
      parts.push(img);
      const sprite = this.add.container(0, 0, parts).setDepth(isBall ? 11 : 10);
      e.set(View, { sprite, shadow, roll: undefined });
    }
  }

  // ---------- input (writes the Aiming trait) ----------
  private discAt(px: number, py: number): Entity | null {
    const reach = Math.max(physicsConfig.disc.radius * S * 1.6, 38);
    let best: Entity | null = null;
    let bestD = reach;
    for (const e of this.entities) {
      if (e.has(IsBall)) continue;
      const pos = e.get(Position)!;
      const p = toPx(pos.x, pos.y);
      const d = Math.hypot(p.x - px, p.y - py);
      if (d < bestD) {
        best = e;
        bestD = d;
      }
    }
    return best;
  }

  /** Pointer position in board (game px) coordinates; the camera is zoomed for 2x art. */
  private worldPoint(pointer: Phaser.Input.Pointer): { x: number; y: number } {
    const p = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    return { x: p.x, y: p.y };
  }

  private aimingEntity(): Entity | null {
    return this.world.queryFirst(Aiming) ?? null;
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    audio.unlock();
    if (this.aimingEntity() || this.world.get(PlaybackTrait)?.active) return;
    const c = this.setup.controller;
    const at = this.worldPoint(pointer);
    const disc = this.discAt(at.x, at.y);
    if (!disc) return;
    const owner = disc.get(Team)!.side;
    if (!c.canAim()) {
      this.setup.onInvalidPress?.('not_your_turn');
      return;
    }
    if (owner !== c.current.turn.side) {
      audio.play('error');
      this.setup.onInvalidPress?.('not_your_disc');
      return;
    }
    audio.play('tap');
    disc.add(Aiming({ angle: 0, power: 0, pointerId: pointer.id }));
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    const disc = this.aimingEntity();
    if (!disc || disc.get(Aiming)!.pointerId !== pointer.id) return;
    const pos = disc.get(Position)!;
    const origin = toPx(pos.x, pos.y);
    const at = this.worldPoint(pointer);
    const dx = at.x - origin.x;
    const dy = at.y - origin.y;
    const len = Math.hypot(dx, dy);
    const s = settingsStore.get();
    // Slingshot: shoot opposite to the drag. Screen y is down, world y is up.
    const angle = Math.atan2(dy, -dx);
    const power = len < MIN_DRAG_PX ? 0 : Math.min(1, (len * s.aimSensitivity) / MAX_DRAG_PX);
    disc.set(Aiming, { angle, power, pointerId: pointer.id });
    this.lastAim = { origin, at };
    this.redrawAim();
  }

  private onPointerUp(pointer: Phaser.Input.Pointer): void {
    const disc = this.aimingEntity();
    if (!disc || disc.get(Aiming)!.pointerId !== pointer.id) return;
    const { angle, power } = disc.get(Aiming)!;
    clearAiming(this.world);
    this.aim.clear();
    this.lastAim = null;
    if (power <= 0) return; // released on the disc: cancel
    this.setup.controller.requestShot(disc.get(BodyRef)!.index, angle, power);
  }

  private redrawAim(): void {
    const disc = this.aimingEntity();
    if (!disc || !this.lastAim) return;
    const { angle, power } = disc.get(Aiming)!;
    this.drawAim(this.lastAim.origin, this.lastAim.at, angle, power, settingsStore.get().aimGuide);
    if (this.fxLevel !== 'off' && power > 0) {
      const side = disc.get(Team)!.side;
      const color = hex(this.teams[side === 'L' ? 0 : 1].primary);
      this.fx.chargeAura(this.aim, this.lastAim.origin, physicsConfig.disc.radius * S, power, color, this.time.now);
    }
  }

  private drawAim(
    origin: { x: number; y: number },
    pointer: { x: number; y: number },
    angle: number,
    power: number,
    guide: boolean,
  ): void {
    const g = this.aim.clear();
    if (power <= 0) return;
    const color = Phaser.Display.Color.Interpolate.ColorWithColor(
      Phaser.Display.Color.ValueToColor(BOARD.aimLow),
      Phaser.Display.Color.ValueToColor(BOARD.aimHigh),
      100,
      Math.round(power * 100),
    );
    const c = Phaser.Display.Color.GetColor(color.r, color.g, color.b);
    const dir = { x: Math.cos(angle), y: -Math.sin(angle) };
    const r = physicsConfig.disc.radius * S;

    g.lineStyle(2, 0xffffff, 0.45);
    const steps = 10;
    for (let i = 0; i < steps; i += 2) {
      const t0 = i / steps;
      const t1 = (i + 1) / steps;
      g.lineBetween(
        origin.x + (pointer.x - origin.x) * t0,
        origin.y + (pointer.y - origin.y) * t0,
        origin.x + (pointer.x - origin.x) * t1,
        origin.y + (pointer.y - origin.y) * t1,
      );
    }
    g.lineStyle(6, c, 0.95);
    g.beginPath();
    g.arc(origin.x, origin.y, r + 10, -Math.PI / 2, -Math.PI / 2 + power * Math.PI * 2);
    g.strokePath();
    const len = 30 + power * 150;
    const tip = { x: origin.x + dir.x * (r + len), y: origin.y + dir.y * (r + len) };
    const base = { x: origin.x + dir.x * (r + 6), y: origin.y + dir.y * (r + 6) };
    g.lineStyle(8, c, 1).lineBetween(base.x, base.y, tip.x, tip.y);
    const nx = -dir.y;
    const ny = dir.x;
    g.fillStyle(c).fillTriangle(
      tip.x + dir.x * 16,
      tip.y + dir.y * 16,
      tip.x + nx * 12,
      tip.y + ny * 12,
      tip.x - nx * 12,
      tip.y - ny * 12,
    );
    if (guide) {
      g.lineStyle(2, 0xffffff, 0.35);
      for (
        let d = 0;
        d < teamAimRange(this.setup.controller.playerOf(this.setup.controller.current.turn.side).teamId);
        d += 22
      ) {
        const s0 = r + len + 24 + d;
        g.lineBetween(
          origin.x + dir.x * s0,
          origin.y + dir.y * s0,
          origin.x + dir.x * (s0 + 10),
          origin.y + dir.y * (s0 + 10),
        );
      }
    }
  }

  private drawRings(): void {
    const g = this.rings.clear();
    const c = this.setup.controller;
    const side: Side = c.current.turn.side;
    const human = c.isHuman(side);
    const s = settingsStore.get();
    const pulse = s.reducedMotion ? 0.8 : 0.55 + 0.35 * Math.sin(this.time.now / 220);
    const r = physicsConfig.disc.radius * S + 6;
    this.world.query(Highlighted, Position).forEach((e) => {
      if (e.has(Aiming)) return;
      const pos = e.get(Position)!;
      const p = toPx(pos.x, pos.y);
      g.lineStyle(s.highContrast ? 5 : 4, human ? BOARD.highlight : 0xffffff, human ? pulse : 0.35);
      g.strokeCircle(p.x, p.y, r);
    });
  }

  // ---------- effects ----------
  private onImpact(impact: Impact): void {
    if (this.time.now - this.lastSfxAt <= 45) return;
    const isBall = this.entities[impact.index]?.has(IsBall) ?? false;
    const strength = Math.min(1, impact.strength * 6);
    audio.play(impact.nearWall ? 'wall' : isBall ? 'ball' : 'hit', strength);
    this.lastSfxAt = this.time.now;
    if (this.fxLevel === 'off' || strength < 0.25) return;
    const p = toPx(impact.x, impact.y);
    if (this.fxLevel === 'full') this.fx.impactStar(p, 18 + 34 * strength, isBall ? 0xffe14d : 0xffffff);
    if (isBall && strength > 0.6) {
      this.shake(0.2 * strength);
      audio.excite(0.35 + 0.3 * strength, 0.3);
    }
  }

  private onEvents(events: MatchEvent[]): void {
    for (const e of events) {
      if (e.type === 'goal') {
        this.crowd?.cheer(this.time.now);
        this.world.set(HoldTrait, { until: this.time.now + GOAL_HOLD_MS });
        audio.play('goal');
        audio.play('wow');
        audio.excite(1, 2.6);
        // Restart jingle once the goal jingle has played and the board resets.
        this.time.delayedCall(1500, () => audio.playSting('kickoff', 0.8));
        audio.vibrate([60, 40, 120]);
        this.goalEffects(e.scorer, e.ownGoal);
      }
      if (e.type === 'timeout') audio.play('error');
      if (e.type === 'ended') audio.play('whistle');
    }
  }

  private goalEffects(scorer: Side, ownGoal: boolean): void {
    const level = this.fxLevel;
    if (level === 'off') return;
    const team = this.teams[scorer === 'L' ? 0 : 1];
    const a = physicsConfig.arena;
    // Scorer L attacks the right goal.
    const goal = toPx(scorer === 'L' ? a.halfWidth : -a.halfWidth, 0);
    this.fx.flash(0xffffff, 0.8, 220);
    this.fx.shockwave(goal, 40, hex(team.primary), 10);
    this.shake(1);
    const cam = this.cameras.main;
    const base = cam.zoom;
    cam.zoomTo(base * 1.07, 110, 'Quad.easeOut', true);
    this.time.delayedCall(140, () => cam.zoomTo(base, 520, 'Quad.easeInOut', true));
    if (level === 'full') {
      this.fx.focusLines(goal, 700, 0.6);
      this.confetti(scorer);
    }
    const label = i18n.t(ownGoal ? 'match.ownGoal' : 'match.goal');
    this.fx.goalSlam(
      label,
      hex(team.primary),
      'Mikhak, sans-serif',
      'banner-goal',
      this.setup.bottomSide === 'R' ? -90 : 90,
    );
  }

  private confetti(scorer: Side): void {
    const team = this.teams[scorer === 'L' ? 0 : 1];
    const colors = [hex(team.primary), hex(team.secondary), 0xffffff];
    for (let k = 0; k < 60; k++) {
      const x = Phaser.Math.Between(80, BOARD.width - 80);
      const piece = this.add
        .rectangle(x, -20, 8, 14, colors[k % colors.length]!)
        .setDepth(30)
        .setAngle(Phaser.Math.Between(0, 360));
      this.tweens.add({
        targets: piece,
        y: BOARD.height + 30,
        x: x + Phaser.Math.Between(-120, 120),
        angle: piece.angle + Phaser.Math.Between(180, 720),
        duration: Phaser.Math.Between(1200, 2200),
        delay: Phaser.Math.Between(0, 300),
        onComplete: () => piece.destroy(),
      });
    }
  }
}

function drawEmblem(g: Phaser.GameObjects.Graphics, emblem: string, cx: number, cy: number, r: number): void {
  const poly = (points: [number, number][]) =>
    g.fillPoints(
      points.map(([x, y]) => new Phaser.Math.Vector2(cx + x * r, cy + y * r)),
      true,
    );
  switch (emblem) {
    case 'star': {
      const pts: [number, number][] = [];
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
        const rr = k % 2 ? 0.45 : 1;
        pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
      }
      poly(pts);
      break;
    }
    case 'bolt':
      poly([
        [-0.2, -1],
        [0.55, -1],
        [0.1, -0.15],
        [0.6, -0.15],
        [-0.45, 1],
        [-0.1, 0.15],
        [-0.6, 0.15],
      ]);
      break;
    case 'crown':
      poly([
        [-0.9, 0.6],
        [-0.9, -0.5],
        [-0.45, 0],
        [0, -0.8],
        [0.45, 0],
        [0.9, -0.5],
        [0.9, 0.6],
      ]);
      break;
    case 'pentagon': {
      const pts: [number, number][] = [];
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
        pts.push([Math.cos(a), Math.sin(a)]);
      }
      poly(pts);
      break;
    }
    case 'wave':
      g.fillCircle(cx - r * 0.45, cy, r * 0.45);
      g.fillCircle(cx + r * 0.45, cy, r * 0.45);
      break;
    case 'leaf':
      g.fillEllipse(cx, cy, r * 1.1, r * 2);
      break;
    default:
      g.fillCircle(cx, cy, r * 0.8);
  }
}
