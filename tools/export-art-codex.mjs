// NOT USED BY THE GAME. Alternative export pipeline written with Codex alongside
// production-manifest.json (art-source/): @2x/@3x copies under the doc's naming.
// It stops on missing output folders and its files are not referenced by the
// app; the game's art comes from tools/export-art.mjs (writes artManifest.json).
// Mechanical exports and geometry-native companions for the approved art masters.
// Usage: node tools/export-art.mjs [directory containing the sharp package]
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp = require(process.argv[2] ? path.join(process.argv[2], 'sharp') : 'sharp');
const root = process.cwd();
const master = path.join(root, 'art-source/masters');
const out = path.join(root, 'apps/web/public/assets');
const records = [];
const manifest = JSON.parse(await fs.readFile('art-source/production-manifest.json', 'utf8'));
const svg = (w, h, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`;
const esc = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
async function write(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data);
}
async function record(file, id, w, h, scale, source) {
  const m = await sharp(file).metadata();
  if (m.width !== w || m.height !== h) throw Error(`Wrong dimensions: ${file}`);
  records.push({
    id,
    file: path.relative(root, file).replaceAll('\\', '/'),
    width: w,
    height: h,
    scale,
    bytes: (await fs.stat(file)).size,
    alpha: m.hasAlpha,
    source,
  });
}
async function raster(id, name, w, h, folder, input, alpha = true, scales = [2, 3]) {
  for (const scale of scales) {
    const W = Math.round(w * scale),
      H = Math.round(h * scale),
      base = path.join(out, folder, `${name}@${scale}x`);
    const image = sharp(input).resize(W, H, { fit: 'fill' }).toColourspace('srgb');
    if (alpha) {
      await image
        .clone()
        .png({ compressionLevel: 9 })
        .toFile(base + '.png');
      await record(base + '.png', id, W, H, scale, 'geometry-native or generated master');
    }
    await image
      .clone()
      .webp(alpha ? { lossless: true } : { quality: 90 })
      .toFile(base + '.webp');
    await record(base + '.webp', id, W, H, scale, 'geometry-native or generated master');
  }
}
async function vector(id, name, w, h, folder, body, rasterize = true) {
  const s = svg(w, h, body),
    f = path.join(out, folder, name + '.svg');
  await write(f, s);
  records.push({
    id,
    file: path.relative(root, f).replaceAll('\\', '/'),
    width: w,
    height: h,
    scale: 'vector',
    bytes: Buffer.byteLength(s),
    alpha: true,
    source: 'original geometry-native SVG',
  });
  if (rasterize) await raster(id, name, w, h, folder, Buffer.from(s));
  return s;
}
const markings = svg(
  990,
  594,
  `<g fill="none" stroke="#eaf7ee" stroke-opacity=".85" stroke-width="3"><path d="M0 0H990V594H0Z M495 0V594"/><circle cx="495" cy="297" r="85.8"/><path d="M0 138.6H145.2V455.4H0 M990 138.6H844.8V455.4H990 M0 191.4H59.4V402.6H0 M990 191.4H930.6V402.6H990"/></g><circle cx="495" cy="297" r="4" fill="#eaf7ee"/>`,
);
await write(path.join(out, 'board/fk_board_markings.svg'), markings);
for (const a of manifest.assets) {
  const input = path.join(master, a.name + '.png');
  if (a.id === 'BRD-FRAME' || a.id === 'BRD-GOAL') continue; // native exact-geometry exports below
  if (a.id === 'BRD-PITCH') {
    for (const scale of [2, 3]) {
      const W = 990 * scale,
        H = 594 * scale;
      const turf = await sharp(input).resize(W, H, { fit: 'fill' }).toBuffer();
      const lines = await sharp(Buffer.from(markings)).resize(W, H).toBuffer();
      const file = path.join(out, a.folder, `fk_board_pitch_${a.name.split('_').at(-1)}@${scale}x.webp`);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await sharp(turf)
        .composite([{ input: lines }])
        .webp({ quality: 90 })
        .toFile(file);
      await record(file, a.id, W, H, scale, a.name + '.png + exact SVG markings');
    }
  } else if (a.id === 'UI-AVATAR') {
    const f = path.join(out, a.folder, a.name + '.png');
    await fs.mkdir(path.dirname(f), { recursive: true });
    await sharp(input).resize(256, 256).png().toFile(f);
    await record(f, a.id, 256, 256, 1, a.name + '.png');
  } else if (a.id === 'MKT-OG') {
    const f = path.join(out, a.folder, a.name + '.jpg');
    await fs.mkdir(path.dirname(f), { recursive: true });
    await sharp(input).resize(1200, 630).jpeg({ quality: 85 }).toFile(f);
    await record(f, a.id, 1200, 630, 1, a.name + '.png');
  } else if (a.id === 'MKT-PROMO') {
    const f = path.join(out, a.folder, a.name + '.jpg');
    await fs.mkdir(path.dirname(f), { recursive: true });
    await sharp(input).resize(a.w, a.h).jpeg({ quality: 90 }).toFile(f);
    await record(f, a.id, a.w, a.h, 1, a.name + '.png');
  } else await raster(a.id, a.name, a.w, a.h, a.folder, input, a.alpha);
  if (a.id === 'PCS-DISC' || a.id === 'PCS-BALL')
    await raster(
      a.id === 'PCS-DISC' ? 'THB-TEAM' : 'THB-BALL',
      a.name.replace('fk_piece_disc_', 'fk_thumb_').replace('fk_piece_ball_', 'fk_thumb_'),
      96,
      96,
      'thumbs',
      input,
      true,
    );
}
const bevel = (light = '#4b679b', dark = '#101a37') =>
  `<defs><linearGradient id="b" x2=".8" y2="1"><stop stop-color="${light}"/><stop offset=".38" stop-color="#22365e"/><stop offset="1" stop-color="${dark}"/></linearGradient><linearGradient id="shine" x2="0" y2="1"><stop stop-color="white" stop-opacity=".6"/><stop offset="1" stop-color="white" stop-opacity="0"/></linearGradient></defs>`;
for (const [theme, accent] of [
  ['park', '#c6ff3d'],
  ['city', '#4cc9f0'],
  ['coast', '#7fe5d0'],
  ['capital', '#ffc83d'],
  ['legends', '#ffd166'],
]) {
  await vector(
    'BRD-FRAME',
    `fk_board_frame_${theme}`,
    1026,
    630,
    'board/' + theme,
    bevel() +
      `<defs><mask id="hole"><rect width="1026" height="630" fill="white"/><rect x="18" y="18" width="990" height="594" fill="black"/></mask></defs><g mask="url(#hole)"><rect x="1.5" y="1.5" width="1023" height="627" rx="22" fill="url(#b)" stroke="${accent}" stroke-width="3"/><rect x="5" y="5" width="1016" height="620" rx="18" fill="none" stroke="url(#shine)" stroke-width="3"/><rect x="15" y="15" width="996" height="600" rx="4" fill="none" stroke="${accent}" stroke-width="3"/></g>`,
  );
}
let net = '';
for (let x = 8; x < 74; x += 9) net += `<path d="M${x} 6V178"/>`;
for (let y = 6; y <= 178; y += 9) net += `<path d="M8 ${y}H74"/>`;
const goalBody =
  bevel() +
  `<rect x="8" y="6" width="66" height="172" fill="#15204a"/><g stroke="#d6efff" stroke-width="1" opacity=".4">${net}</g><path d="M74 6H8V178H74" fill="none" stroke="#425a83" stroke-width="8" stroke-linejoin="round"/><path d="M74 6H8V178H74" fill="none" stroke="#f4f7ff" stroke-width="5" stroke-linejoin="round"/>`;
await vector('BRD-GOAL', 'fk_board_goal_default', 80, 184, 'board', goalBody);
await vector(
  'BRD-NET',
  'fk_board_net',
  32,
  32,
  'board',
  '<path d="M0 0H32M0 8H32M0 16H32M0 24H32M0 0V32M8 0V32M16 0V32M24 0V32" stroke="white" stroke-opacity=".45" stroke-width="1"/>',
);
await vector(
  'BRD-BANNER',
  'fk_board_banner',
  12,
  594,
  'board',
  '<defs><linearGradient id="g"><stop stop-color="#aaa"/><stop offset=".3" stop-color="#fff"/><stop offset="1" stop-color="#777"/></linearGradient></defs><rect width="12" height="594" rx="6" fill="url(#g)"/>',
);
for (const [name, w, h] of [
  ['disc', 58, 44],
  ['ball', 31, 24],
])
  await vector(
    'PCS-SHADOW',
    'fk_piece_shadow_' + name,
    w,
    h,
    'pieces',
    `<defs><radialGradient id="s"><stop stop-color="black" stop-opacity=".28"/><stop offset=".65" stop-color="black" stop-opacity=".18"/><stop offset="1" stop-color="black" stop-opacity="0"/></radialGradient></defs><ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}" fill="url(#s)"/>`,
  );
await vector(
  'PCS-RING',
  'fk_piece_ring',
  76,
  76,
  'pieces',
  '<circle cx="38" cy="38" r="33.7" fill="none" stroke="white" stroke-width="4.5"/>',
);
await vector(
  'PCS-AIM',
  'fk_piece_aim_power',
  88,
  88,
  'pieces',
  '<circle cx="44" cy="44" r="40" stroke="white" stroke-width="4" fill="none"/>',
);
await vector('PCS-AIM', 'fk_piece_aim_head', 32, 28, 'pieces', '<path d="M0 0 32 14 0 28 8 14Z" fill="white"/>');
await vector('PCS-AIM', 'fk_piece_aim_shaft', 24, 8, 'pieces', '<rect width="24" height="8" rx="4" fill="white"/>');
await vector('PCS-AIM', 'fk_piece_aim_dot', 10, 4, 'pieces', '<rect width="10" height="4" rx="2" fill="white"/>');
const paths = {
  home: 'M3 11 12 3 21 11V21H15V15H9V21H3Z',
  shop: 'M4 8H20L19 21H5Z M8 8V6a4 4 0 0 1 8 0V8',
  ranks: 'M8 3H16V9a4 4 0 0 1-8 0Z M8 5H4V8a4 4 0 0 0 4 4 M16 5H20V8a4 4 0 0 1-4 4 M12 13V18 M7 21H17 M9 18H15',
  profile: 'M8 7a4 4 0 1 0 8 0a4 4 0 1 0-8 0 M4 21V19a8 8 0 0 1 16 0V21',
  settings:
    'M9 3H15L16 6 19 7 22 10V14L19 17 16 18 15 21H9L8 18 5 17 2 14V10L5 7 8 6Z M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0',
  back: 'M15 4 7 12 15 20 M7 12H21',
  close: 'M5 5 19 19 M19 5 5 19',
  play: 'M7 3 21 12 7 21Z',
  pause: 'M7 4V20 M17 4V20',
  check: 'M3 12 9 18 21 5',
  lock: 'M5 10H19V21H5Z M8 10V6a4 4 0 0 1 8 0V10',
  robot: 'M5 8H19V20H5Z M12 3V8 M2 12V17 M22 12V17 M8 12H9 M15 12H16 M9 17H15',
  users: 'M5 7a3 3 0 1 0 6 0a3 3 0 1 0-6 0 M2 21V19a6 6 0 0 1 12 0V21 M15 4a3 3 0 1 1 0 6 M17 14a5 5 0 0 1 5 5V21',
  globe: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0 M3 12H21 M12 3C6 8 6 16 12 21C18 16 18 8 12 3',
  history: 'M3 12a9 9 0 1 0 3-6.7 M3 3V8H8 M12 7V12L16 14',
  gift: 'M3 9H21V13H3Z M5 13V21H19V13 M12 9V21 M12 9C3 9 5 1 9 5Z M12 9C21 9 19 1 15 5Z',
  wallet: 'M3 7 18 3V7 M3 7H21V21H3Z M15 12H21V17H15Z',
  info: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0 M12 11V17 M12 7H12.01',
  offline: 'M3 8a15 15 0 0 1 18 0 M6 12a10 10 0 0 1 12 0 M9 16a5 5 0 0 1 6 0 M12 20H12.01 M3 3 21 21',
  school: 'M2 8 12 3 22 8 12 13Z M6 11V17Q12 22 18 17V11 M22 8V17',
  bolt: 'M14 2 3 14H11L10 22 21 10H13Z',
};
for (const [name, d] of Object.entries(paths))
  await vector(
    ['home', 'shop', 'ranks', 'profile', 'settings'].includes(name) ? 'UI-ICON-NAV' : 'UI-ICON-ACTION',
    'fk_icon_' + name,
    24,
    24,
    'ui/icons',
    `<path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
    false,
  );
const emblems = {
  bolt: 'M14 2 3 14H11L10 22 21 10H13Z',
  star: 'M12 2 15 8.5 22 9.5 17 14.5 18 22 12 18 6 22 7 14.5 2 9.5 9 8.5Z',
  wave: 'M2 17C4 8 12 4 19 8C13 6 12 13 16 13C19 13 21 11 22 9C23 17 13 22 2 17Z',
  sun: 'M10 0H14V5H10Z M10 19H14V24H10Z M0 10H5V14H0Z M19 10H24V14H19Z M3 3 7 6 5 9 1 5Z M19 15 23 19 20 22 16 18Z M17 4 21 1 24 5 19 8Z M2 19 6 15 9 18 5 23Z M6 12a6 6 0 1 0 12 0a6 6 0 1 0-12 0',
  crown: 'M2 5 7 10 12 2 17 10 22 5 20 21H4Z',
  leaf: 'M3 21C-1 7 8 0 22 2C24 15 18 25 6 21L18 7Z',
};
for (const [name, d] of Object.entries(emblems))
  await vector('UI-EMBLEM', 'fk_emblem_' + name, 24, 24, 'ui/emblems', `<path d="${d}" fill="currentColor"/>`, false);
for (const [name, color] of [
  ['level', '#ffc83d'],
  ['bot', '#4cc9f0'],
])
  await vector(
    'UI-FRAME',
    'fk_avatar_frame_' + name,
    90,
    90,
    'ui/frames',
    `<rect x="3" y="3" width="84" height="84" rx="14" fill="none" stroke="${color}" stroke-width="6"/><path d="M15 7H68" stroke="white" stroke-opacity=".5" stroke-width="2"/>`,
  );
await raster('UI-SPINNER', 'fk_spinner_ball', 36, 36, 'ui', path.join(master, 'fk_piece_ball_ball_classic.png'));
// Effects are geometry-native, so every frame is deterministic and aligned.
const starPoints = (cx, cy, r) =>
  Array.from({ length: 10 }, (_, i) => {
    const a = (i * Math.PI) / 5 - Math.PI / 2,
      rad = i % 2 ? r * 0.45 : r;
    return `${cx + Math.cos(a) * rad},${cy + Math.sin(a) * rad}`;
  }).join(' ');
async function sheet(id, name, w, h, count, fps, body) {
  for (const scale of [2, 3]) {
    const padding = 2,
      W = w * scale,
      H = h * scale,
      items = [],
      frames = {};
    for (let i = 0; i < count; i++) {
      const input = await sharp(Buffer.from(svg(w, h, body(i, count))))
        .resize(W, H)
        .png()
        .toBuffer();
      items.push({ input, left: i * (W + padding), top: 0 });
      frames[`${name}_${i}`] = {
        frame: { x: i * (W + padding), y: 0, w: W, h: H },
        rotated: false,
        trimmed: false,
        spriteSourceSize: { x: 0, y: 0, w: W, h: H },
        sourceSize: { w: W, h: H },
        duration: 1000 / fps,
      };
    }
    const f = path.join(out, 'fx', `${name}@${scale}x.png`);
    await fs.mkdir(path.dirname(f), { recursive: true });
    await sharp({
      create: { width: count * W + (count - 1) * padding, height: H, channels: 4, background: '#00000000' },
    })
      .composite(items)
      .png({ compressionLevel: 9 })
      .toFile(f);
    await record(f, id, count * W + (count - 1) * padding, H, scale, 'geometry-native aligned frames');
    await write(
      f.replace('.png', '.json'),
      JSON.stringify(
        {
          frames,
          meta: {
            image: path.basename(f),
            format: 'RGBA8888',
            size: { w: count * W + (count - 1) * padding, h: H },
            scale,
            fps,
            frameCount: count,
            atlasPackingRequired: count * W + (count - 1) * padding > 2048,
          },
        },
        null,
        2,
      ),
    );
  }
}
for (const name of ['piece-piece', 'piece-wall'])
  await sheet('FX-IMPACT', 'fk_fx_impact_' + name, 48, 48, 6, 30, (i, n) => {
    const t = i / (n - 1),
      r = 5 + 16 * t;
    return `<g opacity="${1 - t * 0.98}" fill="white"><polygon points="${starPoints(24, 24, r)}"/></g><circle cx="24" cy="24" r="${r}" stroke="white" stroke-width="${3 * (1 - t)}" fill="none" opacity="${1 - t}"/>`;
  });
await vector(
  'FX-TRAIL',
  'fk_fx_trail',
  16,
  16,
  'fx',
  '<defs><radialGradient id="t"><stop stop-color="white" stop-opacity=".6"/><stop offset="1" stop-color="white" stop-opacity="0"/></radialGradient></defs><circle cx="8" cy="8" r="8" fill="url(#t)"/>',
);
for (const [name, w, h, body] of [
  ['rectangle', 8, 14, '<rect width="8" height="14" rx="1" fill="white"/>'],
  ['circle', 10, 10, '<circle cx="5" cy="5" r="5" fill="white"/>'],
  ['star', 12, 12, `<polygon points="${starPoints(6, 6, 6)}" fill="white"/>`],
])
  await vector('FX-GOAL', 'fk_fx_confetti_' + name, w, h, 'fx', body);
await sheet('FX-GOAL', 'fk_fx_goal_flash', 240, 240, 8, 30, (i, n) => {
  const t = i / (n - 1);
  return `<circle cx="120" cy="120" r="${12 + t * 100}" stroke="white" stroke-width="${12 * (1 - t) + 0.2}" fill="none" opacity="${1 - t}"/><polygon points="${starPoints(120, 120, 30 + 75 * t)}" fill="white" opacity="${(1 - t) * 0.65}"/>`;
});
await sheet('HUD-LEVELUP', 'fk_hud_levelup_burst', 240, 240, 12, 24, (i, n) => {
  const t = i / (n - 1);
  return Array.from({ length: 12 }, (_, k) => {
    const a = (k * Math.PI) / 6 + t * 0.12,
      r = 25 + t * 65,
      x = 120 + Math.cos(a) * r,
      y = 120 + Math.sin(a) * r;
    return `<path d="M${x} ${y}l${Math.cos(a) * 25} ${Math.sin(a) * 25}" stroke="#ffc83d" stroke-width="${7 * (1 - t) + 0.2}" opacity="${Math.sin(Math.PI * t)}"/>`;
  }).join('');
});
await sheet('FX-NET', 'fk_fx_net', 80, 184, 10, 30, (i, n) => {
  const t = i / (n - 1),
    bulge = Math.sin(t * Math.PI * 3) * (1 - t) * 5;
  let lines = '';
  for (let y = 6; y <= 178; y += 9) lines += `<path d="M8 ${y}Q${41 - bulge} ${y + bulge} 74 ${y}"/>`;
  for (let x = 8; x < 74; x += 9) lines += `<path d="M${x} 6Q${x - bulge} 92 ${x} 178"/>`;
  return `<rect x="8" y="6" width="66" height="172" fill="#15204a"/><g stroke="white" opacity=".4" stroke-width="1" fill="none">${lines}</g><path d="M74 6H8V178H74" stroke="white" stroke-width="5" fill="none"/>`;
});
// New prefixed PWA files avoid replacing the project's existing browser icons.
for (const [name, size] of [
  ['favicon-32', 32],
  ['apple-touch-icon', 180],
  ['icon-192', 192],
  ['icon-512', 512],
  ['icon-maskable-512', 512],
]) {
  const f = path.join(out, 'branding', 'fk_' + name + '.png');
  await fs.mkdir(path.dirname(f), { recursive: true });
  await sharp(path.join(master, 'fk_logo_mark.png'))
    .resize(size, size)
    .flatten({ background: '#0e1630' })
    .png()
    .toFile(f);
  await record(f, 'MKT-ICON', size, size, 1, 'fk_logo_mark.png');
}
const fav = svg(
  64,
  64,
  '<rect width="64" height="64" rx="12" fill="#0e1630"/><circle cx="30" cy="34" r="17" fill="#f4f7ff"/><path d="M30 20 38 26 35 36H25L22 26Z" fill="#18234a"/><path d="M42 7 20 34H34L25 57 52 27H38Z" fill="#c6ff3d" stroke="#0e1630" stroke-width="2"/>',
);
await write(path.join(out, 'branding/fk_favicon.svg'), fav);
// Lightweight standalone browser review; all images link to actual saved files.
const cards = manifest.assets
  .map(
    (a) =>
      `<figure data-id="${esc(a.id)}"><a href="masters/${esc(a.name)}.png"><img loading="lazy" src="masters/${esc(a.name)}.png" alt="${esc(a.name)}"></a><figcaption><b>${esc(a.id)}</b><br>${esc(a.name)}<br><small>${a.w} × ${a.h} logical · ${a.alpha ? 'alpha' : 'opaque'}</small></figcaption></figure>`,
  )
  .join('');
await write(
  'art-source/gallery.html',
  `<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FlickKick — گالری تصاویر</title><style>body{margin:0;background:#0e1630;color:#f4f7ff;font:16px system-ui;padding:32px}h1{color:#c6ff3d}p{color:#a9b4d6;line-height:1.8}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:20px}figure{margin:0;background:#18234a;border:1px solid #35406b;border-radius:16px;overflow:hidden}img{display:block;width:100%;height:220px;object-fit:contain;background:repeating-conic-gradient(#18234a 0 25%,#22305e 0 50%) 0/24px 24px}figcaption{padding:16px;direction:ltr;font-size:13px;overflow-wrap:anywhere}button{padding:10px 18px;border-radius:10px;border:0;cursor:pointer;background:#c6ff3d;color:#0e1630;margin-bottom:24px}.light img{background:#eee}a:focus-visible,button:focus-visible{outline:3px solid #4cc9f0}</style><h1>FlickKick — گالری تصاویر</h1><p>${manifest.assets.length} تصویر اصلی با سبک تأییدشده. برای دیدن اندازهٔ اصلی روی تصویر بزنید.<br>این صفحه گالری دارایی‌هاست؛ اتصال به بازی و اسکرین‌شات نهایی در این مرحله انجام نشده است.</p><button onclick="document.body.classList.toggle('light')">تغییر زمینهٔ بررسی شفافیت</button><main>${cards}</main></html>`,
);
await write(
  'art-source/export-report.json',
  JSON.stringify(
    {
      date: '2026-10-28',
      masterCount: manifest.assets.length,
      exportCount: records.length,
      files: records,
      limitations: [
        'Runtime asset-loader integration and final-build screenshots are a separate dependent task.',
        'Generated masters retain original resolution; large @2x/@3x exports are upsampled when necessary, not new 4x detail.',
        'Original generated frames/goals are kept as art references; exact geometry-native versions are exported.',
        'Logo wordmark remains raster; outlined SVG and monochrome variants require additional vector finishing.',
        'Generated rank badges remain raster; SVG masters require vector finishing.',
        'Nine-slice banner stretch behaviour, grayscale/deuteranopia, in-game overlay and Lighthouse checks still need runtime validation.',
        'Sprite strips wider than 2048 need scene-atlas packing before shipping.',
      ],
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    { masters: manifest.assets.length, exports: records.length, totalBytes: records.reduce((s, r) => s + r.bytes, 0) },
    null,
    2,
  ),
);
