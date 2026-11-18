import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
const root = path.resolve('art-source/character-roster');
const output = path.resolve('apps/web/public/assets/avatars/roster');
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const files = fs
    .readdirSync(root)
    .filter((f) => /^fk_avatar_.*\.png$/.test(f))
    .sort();
  const assets = [];
  for (const file of files) {
    const meta = await sharp(path.join(root, file)).metadata();
    await sharp(path.join(root, file)).resize(256, 256, { fit: 'contain' }).png().toFile(path.join(output, file));
    assets.push({
      id: file.replace('fk_avatar_', '').replace('.png', ''),
      kind: file.includes('_animal_') ? 'animal' : 'human',
      master: file,
      width: meta.width,
      height: meta.height,
      url: '/assets/avatars/roster/' + file,
    });
  }
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify(
      {
        generator: 'image_gen',
        style: 'Original stylized 3D sports portrait; navy and lime jersey; navy background',
        assets,
      },
      null,
      2,
    ),
  );
  const cards = (kind) =>
    assets
      .filter((a) => a.kind === kind)
      .map(
        (a) =>
          `<a href="${a.master}"><img loading="lazy" src="../../apps/web/public/assets/avatars/roster/${a.master}" alt="${a.id}"><span>${a.id}</span></a>`,
      )
      .join('');
  fs.writeFileSync(
    path.join(root, 'gallery.html'),
    `<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>FlickKick — آواتارها</title><style>body{background:#0e1630;color:white;font:16px system-ui;margin:32px}h1,h2{color:#c6ff3d}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:16px}a{color:white;text-decoration:none;background:#1b294e;border-radius:16px;overflow:hidden}img{width:100%;aspect-ratio:1;object-fit:cover}span{display:block;padding:10px;font-size:12px;direction:ltr}a:hover{outline:2px solid #c6ff3d}</style><h1>آواتارهای FlickKick</h1><p>۳۰ حیوان و ۳۰ شخصیت انسانی — برای دیدن نسخه اصلی روی تصویر کلیک کنید.</p><h2>حیوانات</h2><div class="grid">${cards('animal')}</div><h2>شخصیت‌های انسانی</h2><div class="grid">${cards('human')}</div></html>`,
  );
  console.log(
    JSON.stringify({
      total: assets.length,
      animals: assets.filter((a) => a.kind === 'animal').length,
      humans: assets.filter((a) => a.kind === 'human').length,
      dimensions: [...new Set(assets.map((a) => a.width + 'x' + a.height))],
    }),
  );
})();
