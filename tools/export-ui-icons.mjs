// Runtime export only; the generated transparent masters remain untouched.
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const names = [
  'settings',
  'history',
  'tutorial',
  'level-reward',
  'home',
  'shop',
  'rank',
  'locker',
  'packs',
  'trails',
  'formations',
  'avatars',
  'balls',
  'teams',
];
const destination = join(root, 'apps/web/public/assets/icons');
mkdirSync(destination, { recursive: true });
for (const name of names) {
  await sharp(join(root, `art-source/masters/ui-icons/${name}.png`))
    .trim({ threshold: 12 })
    .resize(128, 128, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 90, alphaQuality: 100, effort: 6 })
    .toFile(join(destination, `${name}.webp`));
}
console.log(`Exported ${names.length} transparent UI icons at 128px.`);
