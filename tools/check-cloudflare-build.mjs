import { readdir, stat, readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';

const root = resolve(import.meta.dirname, '../apps/web/dist');
const files = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else files.push({ path, size: (await stat(path)).size });
  }
}
await walk(root);
if (files.length > 20_000) throw new Error(`Pages file limit exceeded: ${files.length}`);
for (const file of files) {
  if (file.size > 25 * 1024 * 1024) {
    throw new Error(`Pages 25 MiB asset limit exceeded: ${relative(root, file.path)}`);
  }
}
for (const path of [
  'index.html',
  '_redirects',
  'manifest.webmanifest',
  'assets/fonts/Mikhak-VF.woff2',
  'assets/home/toy-stadium-white.webp',
  'assets/home/toy-icons.webp',
  'assets/cars/cicada.glb',
  'assets/cars/cruiser.glb',
  'assets/cars/carrier.glb',
  ...Array.from({ length: 9 }, (_, index) => `assets/cars/tiny-racer-${index + 1}.glb`),
]) {
  if (!(await stat(resolve(root, path))).isFile()) throw new Error(`Missing deployment asset: ${path}`);
}
if (!(await readFile(resolve(root, '_redirects'), 'utf8')).includes('/* /index.html 200')) {
  throw new Error('SPA route fallback is missing');
}
const largest = files.reduce((a, b) => (a.size > b.size ? a : b));
const total = files.reduce((sum, file) => sum + file.size, 0);
console.log(`Cloudflare Pages ready: ${files.length} files, ${(total / 1024 / 1024).toFixed(1)} MiB total.`);
console.log(`Largest asset: ${relative(root, largest.path)} (${(largest.size / 1024 / 1024).toFixed(2)} MiB).`);
console.log('SPA routing, font, menu art and all 12 car models verified.');
