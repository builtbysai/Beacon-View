// Screenshots of the web viewer's screens against offline fixtures, for visual review.
/* global window */
//   BEACON_QA_URL=http://127.0.0.1:5181 node scripts/Capture-BeaconScreens.mjs [screen ...]
// Output: .beacon-dev/screens/<screen>-<width>.png (gitignored). With no arguments every screen is captured.
// Optional: BEACON_QA_SIZES=390x844,1280x800  BEACON_QA_SCHEME=dark
import { createRequire } from 'node:module';
import { downloadsManifest, routes } from './qa-fixtures.mjs';

const require = createRequire(import.meta.url);
const { mkdirSync } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = process.env.BEACON_PLAYWRIGHT_MODULE
  ? require(process.env.BEACON_PLAYWRIGHT_MODULE)
  : require('playwright');

const base = process.env.BEACON_QA_URL || 'http://127.0.0.1:5181';
assert(
  ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname),
  'Use a local server; this capture must never touch a live service.',
);
const out = path.resolve('.beacon-dev/screens');
mkdirSync(out, { recursive: true });

/** name -> [path, optional steps run after load (a function of the page)] */
const screens = {
  dashboard: ['/'],
  cameras: ['/cameras'],
  activity: ['/activity'],
  settings: ['/settings'],
  'settings-notifications': ['/settings?section=notifications'],
  'settings-data': ['/settings?section=data'],
  'settings-access': ['/settings?section=access'],
  'camera-mode': [
    '/camera-mode',
    async (page) =>
      page
        .getByRole('radio', { name: /This device/ })
        .click()
        .then(() =>
          page.getByRole('button', { name: 'Start the camera' }).click(),
        ),
  ],
  'add-camera': ['/camera-mode'],
  'add-device-this': [
    '/camera-mode',
    async (page) => page.getByRole('radio', { name: /This device/ }).click(),
  ],
  'add-device-mobile': [
    '/camera-mode',
    async (page) =>
      page.getByRole('radio', { name: /Phone or tablet/ }).click(),
  ],
  'add-device-ios': [
    '/camera-mode',
    async (page) => {
      await page.getByRole('radio', { name: /Phone or tablet/ }).click();
      await page.getByRole('radio', { name: /iPhone or iPad/ }).click();
    },
  ],
  'add-device-computer': [
    '/camera-mode',
    async (page) => page.getByRole('radio', { name: /^Computer/ }).click(),
  ],
  diagnostics: ['/diagnostics'],
};
const wanted = process.argv.slice(2);
const names = wanted.length ? wanted : Object.keys(screens);
const sizes = (process.env.BEACON_QA_SIZES || '390x844,1280x800')
  .split(',')
  .map((size) => size.split('x').map(Number));

const browser = await chromium.launch({
  channel: process.env.BEACON_QA_CHANNEL || 'msedge',
  headless: true,
});
for (const [width, height] of sizes) {
  const context = await browser.newContext({
    colorScheme: process.env.BEACON_QA_SCHEME || 'light',
    reducedMotion: 'reduce',
    viewport: { width, height },
  });
  await context.addInitScript(() => {
    window.WebSocket = class {
      close() {}
      send() {}
    };
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException('QA permission denied', 'NotAllowedError');
    };
    localStorage.setItem('beacon.splash.seen.v1', 'true');
  });
  await context.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const data = routes[pathname];
    await route.fulfill({
      body: JSON.stringify(data || { error: 'Unmocked endpoint' }),
      contentType: 'application/json',
      status: data ? 200 : 404,
    });
  });
  await context.route('**/downloads/manifest.json', (route) =>
    route.fulfill({
      body: JSON.stringify(downloadsManifest),
      contentType: 'application/json',
    }),
  );
  const page = await context.newPage();
  for (const name of names) {
    const entry = screens[name];
    assert(entry, `Unknown screen: ${name}`);
    await page.goto(new URL(entry[0], base).toString(), {
      waitUntil: 'networkidle',
    });
    await entry[1]?.(page);
    await page.waitForTimeout(600);
    const file = path.join(out, `${name}-${width}.png`);
    await page.screenshot({ fullPage: false, path: file });
    console.log(file);
  }
  await context.close();
}
await browser.close();
