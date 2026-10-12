// Writes manifest.json for a folder of desktop installers, in the format the
// web viewer's downloads page reads (apps/web-viewer/src/downloads.ts).
// Only files that exist are listed, so the site never offers a build that
// was not published.
//
//   node scripts/build-desktop-manifest.mjs <folder> <version>
import { createHash } from 'node:crypto';
import {
  createReadStream,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const [folder, version] = process.argv.slice(2);
if (!folder || !/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error('usage: build-desktop-manifest.mjs <folder> <x.y.z>');
  process.exit(2);
}

/** Maps electron-builder artifact names to manifest entries. */
export function classify(file) {
  // The Android sideload app has its own version, so it is matched by name.
  if (/^Beacon-android-[A-Za-z0-9.-]+\.apk$/.test(file))
    return { arch: 'universal', kind: 'apk', platform: 'android' };
  const arch = /(arm64|aarch64)/i.test(file)
    ? 'arm64'
    : /(x64|x86_64|amd64)/i.test(file)
      ? 'x64'
      : null;
  if (!arch) return null;
  if (/\.exe$/i.test(file) && /setup/i.test(file))
    return { arch, kind: 'installer', platform: 'windows' };
  if (/\.dmg$/i.test(file)) return { arch, kind: 'dmg', platform: 'macos' };
  if (/\.AppImage$/.test(file))
    return { arch, kind: 'appimage', platform: 'linux' };
  if (/\.deb$/i.test(file)) return { arch, kind: 'deb', platform: 'linux' };
  return null;
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

const files = [];
// Only the newest Android app is offered; older ones may stay in the folder.
const androidNames = readdirSync(folder)
  .filter((name) => classify(name)?.platform === 'android')
  .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
const newestAndroid = androidNames.at(-1);
for (const name of readdirSync(folder).sort()) {
  const kind = classify(name);
  if (!kind) continue;
  if (
    kind.platform === 'android'
      ? name !== newestAndroid
      : !name.includes(version)
  )
    continue;
  const full = path.join(folder, name);
  files.push({
    ...kind,
    bytes: statSync(full).size,
    file: name,
    sha256: await sha256(full),
  });
}
if (files.length === 0) {
  console.error(`No ${version} installers found in ${folder}`);
  process.exit(1);
}
const manifest = { files, publishedAt: new Date().toISOString(), version };
writeFileSync(
  path.join(folder, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
for (const file of files)
  console.log(`${file.platform}/${file.arch} ${file.kind}: ${file.file}`);
