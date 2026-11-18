// Renders the asset tables of docs/ART_ASSET_REQUIREMENTS.md from
// docs/art/asset-manifest.json (between the GENERATED markers), and checks
// that every asset ends up with every required field.
//   node tools/art-doc.mjs          write the document
//   node tools/art-doc.mjs --check  fail if the document is out of date
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(`${root}docs/art/asset-manifest.json`, 'utf8'));
const docPath = `${root}docs/ART_ASSET_REQUIREMENTS.md`;

const REQUIRED = [
  'id',
  'name',
  'category',
  'purpose',
  'quantity',
  'display',
  'aspect',
  'format',
  'transparency',
  'animation',
  'slicing',
  'states',
  'screens',
  'layer',
  'naming',
  'priority',
  'placeholder',
  'dependsOn',
  'productionNotes',
  'acceptance',
];

const esc = (v) =>
  String(v ?? '')
    .replaceAll('|', '\\|')
    .replaceAll('\n', ' ');
const errors = [];
const sections = [];
let count = 0;

for (const cat of manifest.categories) {
  const d = cat.defaults;
  const assets = cat.assets.map((a) => {
    const full = {
      category: cat.title,
      dependsOn: 'None',
      ...d,
      ...a,
      productionNotes: [d.productionNotes, a.notes].filter(Boolean).join(' '),
      acceptance: [d.acceptance, a.acceptanceExtra].filter(Boolean).join(' '),
    };
    for (const f of REQUIRED) if (!full[f]) errors.push(`${a.id}: missing ${f}`);
    count++;
    return full;
  });

  const lines = [
    `### ${cat.title}`,
    '',
    '**Category defaults** (apply to every asset below unless the row says otherwise):',
    '',
  ];
  lines.push(`- Format: ${d.format}`, `- Transparency: ${d.transparency}`, `- Animation: ${d.animation}`);
  lines.push(`- Nine-slice / tiling: ${d.slicing}`, `- States: ${d.states}`, `- Layer / draw order: ${d.layer}`);
  lines.push(`- Exports: ${d.exports}`, `- Naming: \`${d.naming}\``, `- Folder: \`${d.folder}\``);
  lines.push(`- Production notes: ${d.productionNotes}`, `- Acceptance: ${d.acceptance}`, '');
  lines.push(
    '| ID | Asset | Purpose & usage | Screen / scene | Qty & variants | Size at 1x (logical px) | Aspect | Specifics (format · alpha · anim · slicing · states · layer) | Priority | Placeholder today | Depends on | Notes & extra acceptance |',
  );
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const a of assets) {
    const raw = cat.assets.find((x) => x.id === a.id);
    const specifics = ['format', 'transparency', 'animation', 'slicing', 'states', 'layer']
      .filter((k) => raw[k])
      .map((k) => `${k}: ${raw[k]}`)
      .join(' · ');
    lines.push(
      `| **${esc(a.id)}** | ${esc(a.name)} | ${esc(a.purpose)} | ${esc(a.screens)} | ${esc(a.quantity)}${
        a.variants ? ` — ${esc(a.variants)}` : ''
      } | ${esc(a.display)} | ${esc(a.aspect)} | ${esc(specifics || 'category defaults')} | ${esc(a.priority)} | ${esc(
        a.placeholder,
      )} | ${esc(a.dependsOn)} | ${esc([raw.notes, raw.acceptanceExtra].filter(Boolean).join(' Acceptance: '))} |`,
    );
  }
  sections.push(lines.join('\n'));
}

const audio = manifest.audio;
const audioLines = [
  '| ID | Sound | Trigger in the game | Duration | Variants | Priority | Placeholder today |',
  '|---|---|---|---|---|---|---|',
  ...audio.assets.map(
    (a) =>
      `| **${esc(a.id)}** | ${esc(a.name)} | ${esc(a.trigger)} | ${esc(a.duration)} | ${esc(a.variants)} | ${esc(
        a.priority,
      )} | ${esc(a.placeholder)} |`,
  ),
];

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

const generated = `${sections.join('\n\n')}\n\n<!-- ${count} visual assets -->`;
const doc = readFileSync(docPath, 'utf8');
const replace = (text, tag, body) => {
  const start = `<!-- GENERATED:${tag}:START -->`;
  const end = `<!-- GENERATED:${tag}:END -->`;
  const a = text.indexOf(start);
  const b = text.indexOf(end);
  if (a < 0 || b < 0) throw new Error(`markers for ${tag} not found`);
  return `${text.slice(0, a + start.length)}\n\n${body}\n\n${text.slice(b)}`;
};
// Format with the project's Prettier config so `--check` and `pnpm format:check` agree.
const options = (await prettier.resolveConfig(docPath)) ?? {};
const next = await prettier.format(replace(replace(doc, 'ASSETS', generated), 'AUDIO', audioLines.join('\n')), {
  ...options,
  filepath: docPath,
});

if (process.argv.includes('--check')) {
  if (next !== doc) {
    console.error('ART_ASSET_REQUIREMENTS.md is out of date: run pnpm art:doc');
    process.exit(1);
  }
  console.log(`ok: ${count} visual assets, ${audio.assets.length} audio assets`);
} else {
  writeFileSync(docPath, next);
  console.log(`wrote ${count} visual assets, ${audio.assets.length} audio assets`);
}
