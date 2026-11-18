// Exports runtime sounds from the sources in art-source/audio/raw into
// apps/web/public/assets/audio (mono SFX) and assets/music (stereo): trimmed, faded, loudness-normalised MP3
// (plays everywhere, including iOS Safari and Android WebView). Needs ffmpeg.
//   node tools/export-audio.mjs
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'art-source/audio/raw');

// id: [source file, start s, length s (0 = to the end), loudness target LUFS]
// Sources: the team's purchased packs (Drive "Sound and SFX"), see docs/ART_ASSET_REQUIREMENTS.md §9.
const SOUNDS = {
  kick: ['good_hit_1.wav', 0, 0.6, -14],
  hit: ['hit_bump_1.wav', 0, 0, -16],
  wall: ['hit_bump_3.wav', 0, 0, -18],
  ball: ['hit_1.mp3', 0, 0.55, -15],
  swoosh: ['swoosh_fast_1.wav', 0, 0, -15],
  impact: ['dramatic_impact.mp3', 1.3, 1.8, -13],
  goal: ['winning01.wav', 0, 0, -14],
  wow: ['wow01.wav', 0, 0, -16],
  oh: ['oh01.wav', 0, 0, -17],
  win: ['win01.wav', 0, 0, -15],
  lose: ['lose01.wav', 0, 0, -16],
};

// Music (the team's own tracks): stereo, gentler loudness, longer fade so loops
// restart smoothly. [source, start s, length s, LUFS]
const MUSIC = {
  menu: ['music/menu_background.mp3', 0.95, 110.5, -17],
  league: ['music/league_menu.mp3', 0, 86.5, -17],
  intro: ['music/stadium_intro.mp3', 0, 24.4, -16],
  kickoff: ['music/in_match.mp3', 0, 5.1, -16],
  // Pixabay content licence (free for games): FatBunny "Soccer", SoundSurfer "Soccer Highlights".
  match: ['music/fatbunny_soccer.mp3', 0, 79, -18],
  highlights: ['music/soundsurfer_soccer_highlights.mp3', 0, 133.4, -17],
};

function encode(id, [file, start, length, lufs], { dir, channels, bitrate, fade }) {
  const input = join(SRC, file);
  if (!existsSync(input)) throw new Error(`missing source ${input}`);
  mkdirSync(join(root, dir), { recursive: true });
  const output = join(root, dir, `${id}.mp3`);
  const fadeOut = length ? `,afade=t=out:st=${Math.max(0, length - fade)}:d=${fade}` : '';
  const args = ['-y', '-v', 'error', '-ss', String(start)];
  if (length) args.push('-t', String(length));
  args.push(
    '-i',
    input,
    '-af',
    `silenceremove=start_periods=1:start_threshold=-50dB,loudnorm=I=${lufs}:TP=-1.5:LRA=11,alimiter=limit=0.84${fadeOut}`,
    '-ac',
    String(channels),
    '-ar',
    '44100',
    '-b:a',
    bitrate,
    output,
  );
  const r = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg failed for ${id}: ${r.stderr}`);
  return statSync(output).size;
}

let total = 0;
for (const [id, spec] of Object.entries(SOUNDS)) {
  total += encode(id, spec, { dir: 'apps/web/public/assets/audio', channels: 1, bitrate: '96k', fade: 0.12 });
}
let music = 0;
for (const [id, spec] of Object.entries(MUSIC)) {
  music += encode(id, spec, { dir: 'apps/web/public/assets/music', channels: 2, bitrate: '128k', fade: 1.2 });
}
console.log(
  `exported ${Object.keys(SOUNDS).length} sounds (${Math.round(total / 1024)} KB) and ${Object.keys(MUSIC).length} music tracks (${Math.round(music / 1024)} KB)`,
);
