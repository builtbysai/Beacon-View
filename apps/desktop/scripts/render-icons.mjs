// Renders the desktop app and tray icons from the web viewer's favicon so
// the installed app keeps the PWA's exact brand mark. Run with
// `pnpm --filter @beacon/desktop icons` after changing favicon.svg.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { chromium } from 'playwright';

const desktopRoot = path.join(import.meta.dirname, '..');
const favicon = readFileSync(
  path.join(desktopRoot, '..', 'web-viewer', 'public', 'favicon.svg'),
  'utf8',
);
// The "live" tray variant adds a red capture dot, mirroring the recording
// indicator language of the Android foreground notification.
const liveDot =
  '<circle cx="50" cy="50" r="13" fill="#ef4444" stroke="#071b31" stroke-width="4" />';

const outputs = [
  { file: 'resources/icon.png', live: false, size: 1024 },
  { file: 'assets/icon.png', live: false, size: 512 },
  { file: 'assets/tray.png', live: false, size: 16 },
  { file: 'assets/tray@2x.png', live: false, size: 32 },
  { file: 'assets/tray-live.png', live: true, size: 16 },
  { file: 'assets/tray-live@2x.png', live: true, size: 32 },
];

const browser = await chromium.launch({
  channel: process.env.BEACON_ICON_CHANNEL || undefined,
});
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const { file, live, size } of outputs) {
    const svg = live ? favicon.replace('</svg>', `${liveDot}</svg>`) : favicon;
    await page.setViewportSize({ height: size, width: size });
    await page.setContent(
      `<html><body style="margin:0;background:transparent">${svg.replace(
        '<svg ',
        `<svg width="${size}" height="${size}" `,
      )}</body></html>`,
    );
    await page
      .locator('svg')
      .screenshot({ omitBackground: true, path: path.join(desktopRoot, file) });
    console.log(`rendered ${file} (${size}px)`);
  }
} finally {
  await browser.close();
}
