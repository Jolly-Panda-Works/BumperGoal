import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';

const android = new URL('./android/app/', import.meta.url);
const manifest = new URL('src/main/AndroidManifest.xml', android);
const xml = readFileSync(manifest, 'utf8');
const activity = /<activity\b[^>]*android:name="\.MainActivity"[^>]*>/;
if (!activity.test(xml)) throw new Error('Capacitor MainActivity declaration was not found');
writeFileSync(
  manifest,
  xml.replace(activity, (tag) => {
    const attributes = tag.replace(/\s+android:screenOrientation="[^"]*"/g, '');
    return attributes.replace(/>$/, ' android:screenOrientation="sensorLandscape">');
  }),
);

const version = process.env.BUMPER_VERSION ?? '1.0.0';
const code = process.env.BUMPER_VERSION_CODE ?? '1';
if (!/^\d+\.\d+\.\d+$/.test(version) || !/^[1-9]\d*$/.test(code) || Number(code) > 2100000000) {
  throw new Error('Invalid Android version or version code');
}
const buildFile = new URL('build.gradle', android);
writeFileSync(
  buildFile,
  readFileSync(buildFile, 'utf8')
    .replace(/versionCode \d+/, `versionCode ${code}`)
    .replace(/versionName "[^"]*"/, `versionName "${version}"`),
);

for (const density of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
  for (const name of ['ic_launcher', 'ic_launcher_round', 'ic_launcher_foreground']) {
    copyFileSync(
      new URL('../web/public/icon-512.png', import.meta.url),
      new URL(`src/main/res/mipmap-${density}/${name}.png`, android),
    );
  }
}
