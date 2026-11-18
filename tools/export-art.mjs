// Exports runtime art from the masters in art-source/masters into
// apps/web/public/assets and writes apps/web/src/game/artManifest.json
// (sizes, 9-slice insets, goal alignment) for the game to read.
//   node tools/export-art.mjs
// Board art targets the 2x board (TD-1): 1 game px = 2 texture px.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'art-source/masters');
const OUT = join(root, 'apps/web/public/assets');
const MANIFEST = join(root, 'apps/web/src/game/artManifest.json');
const THEMES = ['park', 'city', 'coast', 'capital', 'legends'];
// Shop items come from the catalog: adding an entry there plus its image is all
// an export needs (docs/fa/SHOP_ITEMS_GUIDE.md).
const CATALOG = JSON.parse(readFileSync(join(root, 'packages/config/data/cosmetics.json'), 'utf8'));
const FRAME_BORDER_TEX = 72; // frame border thickness in texture px (36 game px at 2x)

const src = (name) => {
  const p = join(SRC, `${name}.png`);
  if (!existsSync(p)) throw new Error(`missing master ${p}`);
  return p;
};
const out = (rel) => {
  const p = join(OUT, rel);
  mkdirSync(dirname(p), { recursive: true });
  return p;
};
const webp = (img, quality = 88) => img.webp({ quality, alphaQuality: 100, effort: 6 });

async function rawAlpha(path) {
  const { data, info } = await sharp(path)
    .ensureAlpha()
    .extractChannel('alpha')
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { a: data, w: info.width, h: info.height };
}

async function alphaBox(path, threshold = 16) {
  const { a, w, h } = await rawAlpha(path);
  let l = w,
    t = h,
    r = -1,
    b = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (a[y * w + x] > threshold) {
        if (x < l) l = x;
        if (x > r) r = x;
        if (y < t) t = y;
        if (y > b) b = y;
      }
    }
  }
  return { left: l, top: t, width: r - l + 1, height: b - t + 1 };
}

/** Crops to the visible pixels and fits them centred into a transparent box. */
async function fitTrimmed(name, file, w, h, quality) {
  return fitTrimmedPath(src(name), file, w, h, quality);
}

async function fitTrimmedPath(input, file, w, h, quality) {
  const box = await alphaBox(input);
  await webp(
    sharp(input)
      .extract(box)
      .resize(w, h, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }),
    quality,
  ).toFile(out(file));
  return { file, w, h };
}

async function cover(name, file, w, h, quality = 84) {
  await webp(sharp(src(name)).resize(w, h, { fit: 'cover', position: 'centre' }), quality).toFile(out(file));
  return { file, w, h };
}

/** Transparent interior of a frame, scanned from the centre outwards. */
async function frameHole(path) {
  const { a, w, h } = await rawAlpha(path);
  const cx = w >> 1;
  const cy = h >> 1;
  const opaque = (x, y) => a[y * w + x] > 128;
  let l = cx;
  while (l > 0 && !opaque(l - 1, cy)) l--;
  let r = cx;
  while (r < w - 1 && !opaque(r + 1, cy)) r++;
  let t = cy;
  while (t > 0 && !opaque(cx, t - 1)) t--;
  let b = cy;
  while (b < h - 1 && !opaque(cx, b + 1)) b++;
  return { w, h, left: l, top: t, right: w - 1 - r, bottom: h - 1 - b };
}

const manifest = { version: 1, scale: 2, themes: {}, goal: null, discs: {}, balls: {}, avatars: {}, ui: {} };

for (const theme of THEMES) {
  const bg = await cover(`fk_board_bg_${theme}`, `board/${theme}/bg.webp`, 1672, 940, 82);
  const turf = await cover(`fk_board_turf_${theme}`, `board/${theme}/turf.webp`, 1620, 972, 85);
  const hole = await frameHole(src(`fk_board_frame_${theme}`));
  const border = (hole.left + hole.right + hole.top + hole.bottom) / 4;
  const f = FRAME_BORDER_TEX / border;
  const fw = Math.round(hole.w * f);
  const fh = Math.round(hole.h * f);
  await webp(sharp(src(`fk_board_frame_${theme}`)).resize(fw, fh), 90).toFile(out(`board/${theme}/frame.webp`));
  manifest.themes[theme] = {
    bg,
    turf,
    frame: {
      file: `board/${theme}/frame.webp`,
      w: fw,
      h: fh,
      // 9-slice insets in texture px: the hole between them maps exactly onto the pitch.
      insets: {
        left: Math.round(hole.left * f),
        top: Math.round(hole.top * f),
        right: Math.round(hole.right * f),
        bottom: Math.round(hole.bottom * f),
      },
    },
  };
}

{
  // Goal: crop to the art, find where the net box ends (the goal line) on the middle row.
  const name = 'fk_board_goal_default';
  const box = await alphaBox(src(name));
  const { a, w } = await rawAlpha(src(name));
  const midY = box.top + (box.height >> 1);
  let x = box.left;
  while (x < box.left + box.width && a[midY * w + x] <= 128) x++; // skip leading transparency
  while (x < box.left + box.width && a[midY * w + x] > 128) x++; // net box
  const mouth = (x - box.left) / box.width;
  // Fit to the physical pocket: the net box spans the 66 game px pocket (+4 px
  // bleed) and the full 184 px mouth height. The master is almost square, so
  // this compresses it horizontally (see ART_ASSET_REQUIREMENTS, delivery notes).
  const gh = 368;
  const gw = Math.round((70 * 2) / mouth);
  await webp(sharp(src(name)).extract(box).resize(gw, gh, { fit: 'fill' }), 90).toFile(out('board/goal.webp'));
  manifest.goal = { file: 'board/goal.webp', w: gw, h: gh, mouthX: Number(mouth.toFixed(4)), opensTo: 'right' };
}

/** Exports one catalog item if its image exists; otherwise the game keeps its placeholder. */
async function catalogArt(id, input, make) {
  if (!existsSync(input)) {
    console.warn(`no art for ${id} (${input}); the game draws a placeholder`);
    return undefined;
  }
  return make(input);
}

// Teams: FlickKick originals from masters/fk_piece_disc_<id>.png; national and club
// teams from country-club-discs/fk_disc_<id without the nation_/club_ prefix>.png.
for (const team of CATALOG.teams) {
  let input =
    team.group === 'nation' || team.group === 'club'
      ? join(root, 'art-source/country-club-discs', `fk_disc_${team.id.replace(/^(nation|club)_/, '')}.png`)
      : join(SRC, `fk_piece_disc_${team.id}.png`);
  const corrected = input.replace(/\.png$/, '_v2.png');
  if (existsSync(corrected)) input = corrected;
  const art = await catalogArt(team.id, input, (i) => fitTrimmedPath(i, `pieces/disc_${team.id}.webp`, 112, 112, 90));
  if (art) manifest.discs[team.id] = art;
}
// Balls: shop/locker preview from masters/fk_piece_ball_<id>.png (the match uses the
// rolling sheet built from the ball texture further below).
for (const ball of CATALOG.balls) {
  const art = await catalogArt(ball.id, join(SRC, `fk_piece_ball_${ball.id}.png`), (i) =>
    fitTrimmedPath(i, `pieces/${ball.id}.webp`, 60, 60, 90),
  );
  if (art) manifest.balls[ball.id] = art;
}
// Avatars: masters/fk_avatar_<id without avatar_>.png; the bot avatar is not for sale.
for (const id of [...CATALOG.avatars.map((a) => a.id), 'bot']) {
  const name = id.replace(/^avatar_/, '');
  const art = await catalogArt(id, join(SRC, `fk_avatar_${name}.png`), async (i) => {
    await webp(sharp(i).resize(256, 256, { fit: 'cover', position: 'centre' }), 86).toFile(out(`avatars/${name}.webp`));
    return { file: `avatars/${name}.webp`, w: 256, h: 256 };
  });
  if (art) manifest.avatars[id] = art;
}

const ui = manifest.ui;
ui.coin = await fitTrimmed('fk_currency_coin', 'ui/coin.webp', 64, 64, 90);
ui.gem = await fitTrimmed('fk_currency_gem', 'ui/gem.webp', 64, 64, 90);
for (const m of ['online', 'ai', 'local'])
  ui[`mode_${m}`] = await fitTrimmed(`fk_mode_${m}`, `ui/mode_${m}.webp`, 320, 240, 86);
for (const s of ['empty-history', 'empty-wallet', 'not-found', 'offline-server', 'error'])
  ui[`state_${s}`] = await fitTrimmed(`fk_state_${s}`, `ui/state_${s}.webp`, 320, 256, 86);
for (const t of THEMES) ui[`arena_${t}`] = await cover(`fk_arena_${t}`, `ui/arena_${t}.webp`, 640, 240, 82);
// Coin/gem packs: masters/fk_thumb_<pack id>.png.
for (const pack of CATALOG.currencyPacks) {
  const art = await catalogArt(pack.id, join(SRC, `fk_thumb_${pack.id}.png`), (i) =>
    fitTrimmedPath(i, `thumbs/${pack.id}.webp`, 192, 192, 88),
  );
  if (art) ui[pack.id] = art;
}
for (const r of ['coins-small', 'coins-medium', 'coins-large', 'gems'])
  ui[`reward_${r}`] = await fitTrimmed(`fk_thumb_reward_${r}`, `thumbs/reward_${r}.webp`, 128, 128, 88);
for (const r of ['bronze', 'silver', 'gold', 'platinum', 'legend'])
  ui[`rank_${r}`] = await fitTrimmed(`fk_thumb_rank_${r}`, `thumbs/rank_${r}.webp`, 128, 128, 88);

// HUD, tutorial, result and matchmaking art.
ui.banner_goal = await fitTrimmed('fk_hud_banner_goal', 'ui/banner_goal.webp', 720, 240, 88);
ui.banner_info = await fitTrimmed('fk_hud_banner_info', 'ui/banner_info.webp', 640, 200, 88);
for (const [i, step] of ['press', 'drag', 'release'].entries())
  ui[`coach_${i + 1}`] = await fitTrimmed(`fk_hud_coach_step${i + 1}-${step}`, `ui/coach_${i + 1}.webp`, 480, 320, 86);
ui.levelup = await fitTrimmed('fk_hud_levelup_badge', 'ui/levelup.webp', 240, 220, 88);
ui.result_victory = await fitTrimmed('fk_hud_result_victory', 'ui/result_victory.webp', 720, 240, 88);
ui.result_defeat = await fitTrimmed('fk_hud_result_defeat', 'ui/result_defeat.webp', 720, 240, 88);
ui.vs = await fitTrimmed('fk_hud_vs', 'ui/vs.webp', 360, 240, 88);
ui.wordmark = await fitTrimmed('fk_logo_wordmark', 'ui/wordmark.webp', 480, 160, 90);
manifest.avatars.unknown = await fitTrimmed('fk_hud_unknown', 'avatars/unknown.webp', 256, 256, 86);
// Promo art: welcome hero (per orientation), home banner, install screenshots.
ui.promo_landscape = await cover('fk_promo_landscape', 'ui/promo_landscape.webp', 1280, 720, 80);
ui.promo_portrait = await cover('fk_promo_portrait', 'ui/promo_portrait.webp', 720, 1280, 80);
ui.promo_square = await cover('fk_promo_square', 'ui/promo_square.webp', 960, 960, 80);
ui.promo_wide = await cover('fk_promo_wide', 'ui/promo_wide.webp', 1440, 480, 80);
// Link previews (og:image) live at the site root as JPEG, the most widely supported format.
for (const lang of ['en', 'fa']) {
  await sharp(src(`fk_og_${lang}`))
    .resize(1200, 630, { fit: 'cover' })
    .jpeg({ quality: 84, mozjpeg: true })
    .toFile(join(root, `apps/web/public/og-${lang}.jpg`));
}

// Rolling ball: each flat (equirectangular) texture is projected onto a sphere
// seen from straight above and turned one full revolution about the screen's
// vertical axis, so frame k shows the surface moved right by k/FRAMES of a turn.
// The game rotates the strip to the travel direction and steps frames by
// distance. Lighting is a separate fixed overlay (pieces/ball_shade.webp).
{
  const FRAME = 64;
  const FRAMES = 24;
  const SS = 4; // supersamples per axis: smooth edge and less shimmer
  manifest.ballRolls = {};
  // One rolling sheet per catalog ball: art-source/ball-textures/fk_ball_texture_<id without ball_>.
  for (const skin of CATALOG.balls.map((b) => b.id.replace(/^ball_/, ''))) {
    // Prefer the 2048x1024 delivery; fall back to the first master.
    const hires = join(root, `art-source/ball-textures/fk_ball_texture_${skin}_2048x1024.png`);
    const texPath = existsSync(hires)
      ? hires
      : join(root, `art-source/ball-textures/fk_ball_texture_${skin}_master.png`);
    if (!existsSync(texPath)) continue;
    // Pre-shrink: one turn spans ~200 px on screen; sampling 1774 px directly would alias.
    const TW = 768;
    const TH = 384;
    const { data: tex } = await sharp(texPath)
      .resize(TW, TH, { fit: 'fill', kernel: 'lanczos3' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const sample = (u, v, out) => {
      // bilinear, wrapping horizontally, clamped vertically
      const x = (((u % TW) + TW) % TW) - 0.5;
      const y = Math.min(TH - 1, Math.max(0, v - 0.5));
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const fx = x - x0;
      const fy = y - y0;
      const x0w = (x0 + TW) % TW;
      const x1w = (x0 + 1) % TW;
      const y1 = Math.min(TH - 1, y0 + 1);
      for (let c = 0; c < 3; c++) {
        const p00 = tex[(y0 * TW + x0w) * 3 + c];
        const p10 = tex[(y0 * TW + x1w) * 3 + c];
        const p01 = tex[(y1 * TW + x0w) * 3 + c];
        const p11 = tex[(y1 * TW + x1w) * 3 + c];
        out[c] = (p00 * (1 - fx) + p10 * fx) * (1 - fy) + (p01 * (1 - fx) + p11 * fx) * fy;
      }
    };
    const W = FRAME * FRAMES;
    const img = Buffer.alloc(W * FRAME * 4);
    const rgb = [0, 0, 0];
    const r = FRAME / 2;
    for (let k = 0; k < FRAMES; k++) {
      const theta = (k / FRAMES) * Math.PI * 2;
      for (let py = 0; py < FRAME; py++) {
        for (let px = 0; px < FRAME; px++) {
          let R = 0;
          let G = 0;
          let B = 0;
          let hits = 0;
          for (let sy = 0; sy < SS; sy++) {
            for (let sx = 0; sx < SS; sx++) {
              const x = (px + (sx + 0.5) / SS - r) / r;
              const y = (py + (sy + 0.5) / SS - r) / r;
              const d = x * x + y * y;
              if (d > 1) continue;
              const z = Math.sqrt(1 - d);
              const lon = Math.atan2(x, z) - theta;
              const lat = Math.asin(y);
              sample((lon / (Math.PI * 2) + 0.5) * TW, (lat / Math.PI + 0.5) * TH, rgb);
              R += rgb[0];
              G += rgb[1];
              B += rgb[2];
              hits++;
            }
          }
          const o = (py * W + k * FRAME + px) * 4;
          if (hits) {
            img[o] = R / hits;
            img[o + 1] = G / hits;
            img[o + 2] = B / hits;
            img[o + 3] = Math.round((hits / (SS * SS)) * 255);
          }
        }
      }
    }
    const file = `pieces/ball_roll_${skin}.webp`;
    await sharp(img, { raw: { width: W, height: FRAME, channels: 4 } })
      .webp({ lossless: true, effort: 6 })
      .toFile(out(file));
    manifest.ballRolls[`ball_${skin}`] = { file, frame: FRAME, frames: FRAMES };
  }
  // Shared lighting: soft top-left highlight, darker rim, nothing outside the disc.
  const shade = Buffer.alloc(FRAME * FRAME * 4);
  for (let py = 0; py < FRAME; py++) {
    for (let px = 0; px < FRAME; px++) {
      const x = (px + 0.5 - FRAME / 2) / (FRAME / 2);
      const y = (py + 0.5 - FRAME / 2) / (FRAME / 2);
      const d = Math.sqrt(x * x + y * y);
      if (d > 1) continue;
      const edge = Math.min(1, (1 - d) * FRAME * 0.5); // anti-aliased rim
      const rim = Math.pow(d, 3) * 0.55; // darkening towards the limb
      const hx = x + 0.38;
      const hy = y + 0.42;
      const spec = Math.max(0, 1 - Math.sqrt(hx * hx + hy * hy) / 0.42) ** 2 * 0.85;
      const o = (py * FRAME + px) * 4;
      // White highlight over a navy rim shadow, blended (no hard edge between them).
      const alpha = spec + rim * (1 - spec);
      if (alpha > 0) {
        const k = spec / alpha;
        shade[o] = Math.round(255 * k + 8 * (1 - k));
        shade[o + 1] = Math.round(255 * k + 12 * (1 - k));
        shade[o + 2] = Math.round(255 * k + 30 * (1 - k));
        shade[o + 3] = Math.round(alpha * edge * 255);
      }
    }
  }
  await sharp(shade, { raw: { width: FRAME, height: FRAME, channels: 4 } })
    .webp({ lossless: true })
    .toFile(out('pieces/ball_shade.webp'));
  manifest.ballShade = { file: 'pieces/ball_shade.webp', w: FRAME, h: FRAME };
}

writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
const count =
  Object.keys(manifest.themes).length * 3 +
  1 +
  Object.keys(manifest.discs).length +
  Object.keys(manifest.balls).length +
  Object.keys(manifest.avatars).length +
  Object.keys(ui).length;
console.log(`exported ${count} files to apps/web/public/assets; manifest: apps/web/src/game/artManifest.json`);
console.log(JSON.stringify({ frame_park: manifest.themes.park.frame, goal: manifest.goal }));
