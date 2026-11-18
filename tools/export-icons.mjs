// Exports the app icons (web app manifest, Android/iOS home screen) from the
// logo mark master into apps/web/public.
//   node tools/export-icons.mjs
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mark = join(root, 'art-source/masters/fk_logo_mark.png');
const out = (file) => join(root, 'apps/web/public', file);

const icon = (size, file) => sharp(mark).resize(size, size).png({ compressionLevel: 9 }).toFile(out(file));
await icon(192, 'icon-192.png');
await icon(512, 'icon-512.png');
await icon(180, 'apple-touch-icon.png');

// Maskable: the art sits in the safe zone and the mark's own background colour
// fills the rest, so Android's circle/squircle crop never cuts it.
const { data } = await sharp(mark)
  .extract({ left: 4, top: 4, width: 1, height: 1 })
  .raw()
  .toBuffer({ resolveWithObject: true });
const background = { r: data[0], g: data[1], b: data[2], alpha: 1 };
const inner = Math.round(512 * 0.78);
const pad = (512 - inner) >> 1;
await sharp(mark)
  .resize(inner, inner)
  .extend({ top: pad, bottom: 512 - inner - pad, left: pad, right: 512 - inner - pad, background })
  .png({ compressionLevel: 9 })
  .toFile(out('icon-maskable-512.png'));
console.log(`icons written; background rgb(${data[0]}, ${data[1]}, ${data[2]})`);
