// Sound: recorded samples from public/assets/audio (tools/export-audio.mjs),
// streamed music from public/assets/music, a procedural stadium crowd, and
// synthesised fallbacks for any sample that is missing or not decoded yet.
// Everything goes through the SFX/music buses, so the volume and mute settings
// apply to all of it.
import { settingsStore, type Settings } from './settings';

export type Sfx =
  | 'tap'
  | 'kick'
  | 'horn'
  | 'hit'
  | 'ball'
  | 'wall'
  | 'swoosh'
  | 'impact'
  | 'goal'
  | 'wow'
  | 'oh'
  | 'whistle'
  | 'win'
  | 'lose'
  | 'error'
  | 'coin';

/** Recorded samples and their mix level; the rest stay synthesised. */
const SAMPLES: Partial<Record<Sfx, { file: string; gain: number; vary?: boolean }>> = {
  kick: { file: 'kick.mp3', gain: 0.9 },
  hit: { file: 'hit.mp3', gain: 0.55, vary: true },
  ball: { file: 'ball.mp3', gain: 0.7, vary: true },
  wall: { file: 'wall.mp3', gain: 0.45, vary: true },
  swoosh: { file: 'swoosh.mp3', gain: 0.7 },
  impact: { file: 'impact.mp3', gain: 0.75 },
  goal: { file: 'goal.mp3', gain: 0.75 },
  wow: { file: 'wow.mp3', gain: 0.6 },
  oh: { file: 'oh.mp3', gain: 0.55 },
  win: { file: 'win.mp3', gain: 0.7 },
  lose: { file: 'lose.mp3', gain: 0.6 },
};

const sampleUrl = (file: string) => `${import.meta.env.BASE_URL}assets/audio/${file}`;

/**
 * Music tracks. Loops play per screen; `intro` (match walk-on) and `kickoff`
 * (restart after a goal) are one-shot stings.
 */
export type Track = 'menu' | 'league' | 'match' | 'highlights' | 'intro' | 'kickoff';
const musicUrl = (track: Track) => `${import.meta.env.BASE_URL}assets/music/${track}.mp3`;
const MUSIC_FADE_S = 0.8;

interface MusicVoice {
  track: Track;
  el: HTMLAudioElement;
  gain: GainNode;
}

class AudioService {
  private ctx: AudioContext | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  /** The looping track for the current screen, and the one wanted before audio was unlocked. */
  private loop: MusicVoice | null = null;
  private wantedLoop: Track | null = null;
  private loopLevel = 1;
  private stings = new Set<MusicVoice>();
  private buffers = new Map<Sfx, AudioBuffer>();
  private crowdNodes: { source: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private crowdLevel = 0;

  constructor() {
    settingsStore.subscribe(() => this.apply(settingsStore.get()));
    // Phones: stop all sound while the app is in the background.
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (!this.ctx) return;
        const voices = [this.loop, ...this.stings].filter((v): v is MusicVoice => !!v);
        if (document.hidden) {
          voices.forEach((v) => v.el.pause());
          void this.ctx.suspend();
        } else {
          void this.ctx.resume();
          voices.forEach((v) => void v.el.play().catch(() => undefined));
        }
      });
    }
  }

  /** Must be called from a user gesture (browser autoplay policy). */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
      this.sfxGain = this.ctx.createGain();
      this.musicGain = this.ctx.createGain();
      this.sfxGain.connect(this.ctx.destination);
      this.musicGain.connect(this.ctx.destination);
      this.apply(settingsStore.get());
      void this.loadSamples(this.ctx);
      if (this.wantedLoop) this.playMusic(this.wantedLoop, this.loopLevel);
    } catch {
      this.ctx = null; // no audio support: the game stays playable silently
    }
  }

  private async loadSamples(ctx: AudioContext): Promise<void> {
    await Promise.all(
      Object.entries(SAMPLES).map(async ([id, s]) => {
        try {
          const res = await fetch(sampleUrl(s.file));
          if (!res.ok) return;
          this.buffers.set(id as Sfx, await ctx.decodeAudioData(await res.arrayBuffer()));
        } catch {
          // keep the synthesised fallback for this sound
        }
      }),
    );
  }

  private apply(s: Settings): void {
    if (!this.ctx || !this.sfxGain || !this.musicGain) return;
    const t = this.ctx.currentTime;
    this.sfxGain.gain.setTargetAtTime(s.muted ? 0 : s.sfxVolume, t, 0.02);
    this.musicGain.gain.setTargetAtTime(s.muted ? 0 : s.musicVolume * 0.7, t, 0.05);
  }

  private running(): { ctx: AudioContext; out: GainNode } | null {
    const ctx = this.ctx;
    const out = this.sfxGain;
    if (!ctx || !out || ctx.state !== 'running') return null;
    return { ctx, out };
  }

  play(sfx: Sfx, intensity = 1): void {
    const r = this.running();
    if (!r) return;
    const v = Math.min(1, Math.max(0.15, intensity));
    const buffer = this.buffers.get(sfx);
    const sample = SAMPLES[sfx];
    if (buffer && sample) {
      const src = r.ctx.createBufferSource();
      const g = r.ctx.createGain();
      src.buffer = buffer;
      // Small pitch variation so repeated collisions do not sound mechanical.
      if (sample.vary) src.playbackRate.value = 0.92 + Math.random() * 0.16;
      g.gain.value = sample.gain * v;
      src.connect(g).connect(r.out);
      src.start();
      return;
    }
    this.synth(r.ctx, r.out, sfx, v);
  }

  private synth(ctx: AudioContext, out: GainNode, sfx: Sfx, v: number): void {
    const t = ctx.currentTime;
    const tone = (freq: number, dur: number, type: OscillatorType, gain: number, at = 0, slideTo?: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t + at);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + at + dur);
      g.gain.setValueAtTime(0.0001, t + at);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + dur);
      o.connect(g).connect(out);
      o.start(t + at);
      o.stop(t + at + dur + 0.02);
    };
    switch (sfx) {
      case 'tap':
        tone(660, 0.06, 'triangle', 0.2);
        break;
      case 'kick':
        tone(180, 0.12, 'sine', 0.6 * v, 0, 70);
        break;
      case 'hit':
      case 'ball':
        tone(420, 0.05, 'square', 0.18 * v);
        break;
      case 'horn':
        for (const at of [0, 0.17]) {
          tone(392, 0.13, 'sawtooth', 0.1 * v, at);
          tone(494, 0.13, 'triangle', 0.075 * v, at);
        }
        break;
      case 'wall':
        tone(140, 0.06, 'triangle', 0.25 * v);
        break;
      case 'swoosh':
        tone(900, 0.18, 'sawtooth', 0.06 * v, 0, 200);
        break;
      case 'impact':
        tone(90, 0.4, 'sine', 0.7 * v, 0, 40);
        break;
      case 'goal':
        [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, 'triangle', 0.35, i * 0.09));
        break;
      case 'whistle':
        tone(2100, 0.35, 'sine', 0.2, 0, 2300);
        break;
      case 'win':
        [392, 523, 659, 784].forEach((f, i) => tone(f, 0.3, 'triangle', 0.3, i * 0.12));
        break;
      case 'lose':
        [392, 330, 262].forEach((f, i) => tone(f, 0.35, 'sine', 0.25, i * 0.16));
        break;
      case 'error':
        tone(200, 0.12, 'sawtooth', 0.12);
        break;
      case 'coin':
        tone(988, 0.08, 'square', 0.12);
        tone(1318, 0.14, 'square', 0.12, 0.07);
        break;
      case 'wow':
      case 'oh':
        break; // reactions are voice-only
    }
  }

  // ---------- stadium crowd ----------

  /**
   * Starts the crowd bed: looped noise shaped by a band-pass filter, which
   * reads as a distant stadium murmur. The packs in use have no crowd
   * recordings; a recorded loop can replace the noise source later.
   */
  startCrowd(): void {
    const r = this.running();
    if (!r || this.crowdNodes) return;
    const { ctx, out } = r;
    const seconds = 3;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    // Brown-ish noise with slow random swells (many voices, no clear pitch).
    let last = 0;
    let swell = 0.5;
    for (let i = 0; i < data.length; i++) {
      if (i % 2205 === 0) swell = Math.min(1, Math.max(0.35, swell + (Math.random() - 0.5) * 0.25));
      last = (last + 0.04 * (Math.random() * 2 - 1)) / 1.04;
      data[i] = last * 3.2 * swell;
    }
    const fade = Math.floor(ctx.sampleRate * 0.05); // seamless loop
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      data[data.length - fade + i] = data[data.length - fade + i]! * (1 - k) + data[i]! * k;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 700;
    filter.Q.value = 0.6;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    source.connect(filter).connect(gain).connect(out);
    source.start();
    this.crowdNodes = { source, gain, filter };
    this.crowdLevel = 0;
    this.excite(0.18, 1.2);
  }

  stopCrowd(): void {
    const nodes = this.crowdNodes;
    const ctx = this.ctx;
    if (!nodes || !ctx) return;
    nodes.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.3);
    nodes.source.stop(ctx.currentTime + 1.5);
    this.crowdNodes = null;
  }

  /** Moves the crowd to a level (0 calm … 1 roaring) and lets it settle back. */
  excite(level: number, holdSeconds = 0.6): void {
    const nodes = this.crowdNodes;
    const ctx = this.ctx;
    if (!nodes || !ctx) return;
    const t = ctx.currentTime;
    const base = 0.18;
    const target = Math.max(base, Math.min(1, level));
    if (target < this.crowdLevel && holdSeconds > 0) return; // a bigger moment is still playing
    this.crowdLevel = target;
    const g = nodes.gain.gain;
    const f = nodes.filter.frequency;
    g.cancelScheduledValues(t);
    f.cancelScheduledValues(t);
    g.setTargetAtTime(0.12 + target * 0.55, t, 0.08);
    f.setTargetAtTime(600 + target * 900, t, 0.1);
    g.setTargetAtTime(0.12 + base * 0.55, t + holdSeconds, 0.9);
    f.setTargetAtTime(600 + base * 900, t + holdSeconds, 0.9);
    window.setTimeout(() => (this.crowdLevel = base), (holdSeconds + 1.5) * 1000);
  }

  // ---------- music ----------

  /**
   * Streams a track through the music bus (an <audio> element, not a decoded
   * buffer: a two-minute track would cost tens of MB of memory on a phone).
   */
  private voice(track: Track, loop: boolean): MusicVoice | null {
    const ctx = this.ctx;
    const out = this.musicGain;
    if (!ctx || !out) return null;
    try {
      const el = new Audio(musicUrl(track));
      el.loop = loop;
      el.preload = 'auto';
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      ctx.createMediaElementSource(el).connect(gain).connect(out);
      void el.play().catch(() => undefined);
      return { track, el, gain };
    } catch {
      return null;
    }
  }

  private fadeOut(v: MusicVoice, seconds = MUSIC_FADE_S): void {
    const ctx = this.ctx;
    if (!ctx) return;
    v.gain.gain.cancelScheduledValues(ctx.currentTime);
    v.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, seconds / 4);
    window.setTimeout(
      () => {
        v.el.pause();
        v.el.removeAttribute('src');
        v.el.load();
        v.gain.disconnect();
      },
      seconds * 1000 + 100,
    );
  }

  /**
   * Crossfades to a looping track (at `level`, after `delayS`); null fades the
   * music out. Safe to call before unlock: the wanted track starts on unlock.
   */
  playMusic(track: Track | null, level = 1, delayS = 0): void {
    this.wantedLoop = track;
    this.loopLevel = level;
    if (!this.ctx) return;
    if (this.loop?.track === track) {
      this.loop.gain.gain.setTargetAtTime(level, this.ctx.currentTime, 0.3);
      return;
    }
    if (this.loop) this.fadeOut(this.loop);
    this.loop = null;
    if (!track) return;
    const start = () => {
      if (this.wantedLoop !== track || this.loop || !this.ctx) return;
      const v = this.voice(track, true);
      if (!v) return;
      v.gain.gain.setTargetAtTime(level, this.ctx.currentTime, MUSIC_FADE_S / 4);
      this.loop = v;
    };
    if (delayS > 0) window.setTimeout(start, delayS * 1000);
    else start();
  }

  /** Plays a one-shot music sting over whatever else is playing. */
  playSting(track: Track, level = 1, onEnded?: () => void): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const v = this.voice(track, false);
    if (!v) return;
    v.gain.gain.setTargetAtTime(level, ctx.currentTime, 0.02);
    this.stings.add(v);
    v.el.addEventListener('ended', () => {
      this.stings.delete(v);
      v.gain.disconnect();
      onEnded?.();
    });
  }

  /** Lowers (0..1) or fades out (0) the stings still playing, e.g. the match intro once play starts. */
  duckStings(level: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    for (const v of this.stings) {
      if (level <= 0) {
        this.stings.delete(v);
        this.fadeOut(v, 1.2);
      } else {
        v.gain.gain.setTargetAtTime(level, ctx.currentTime, 0.4);
      }
    }
  }

  vibrate(pattern: number | number[]): void {
    if (!settingsStore.get().vibration) return;
    try {
      navigator.vibrate?.(pattern);
    } catch {
      // unsupported
    }
  }
}

export const audio = new AudioService();
