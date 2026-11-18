// Deterministic runtime export; original generated PNGs remain unchanged.
import sharp from 'sharp';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { trails } = JSON.parse(readFileSync(join(root, 'packages/config/data/cosmetics.json'), 'utf8'));
const destination = join(root, 'apps/web/public/assets/trails');
mkdirSync(destination, { recursive: true });
for (const trail of trails) {
  await sharp(join(root, `art-source/masters/trail-icons/${trail.id}.png`))
    .trim({ threshold: 12 })
    .resize(160, 160, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 90, alphaQuality: 100, effort: 6 })
    .toFile(join(destination, `${trail.id}.webp`));
}
console.log(`Exported ${trails.length} transparent trail icons.`);
