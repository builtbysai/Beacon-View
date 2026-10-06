// Launches the real Electron desktop app (apps/desktop) against a local web
// viewer dev server and exercises the shell's security and background
// behavior. Every /api call is an isolated fixture; nothing reaches a live
// service, the system browser, or the machine's deep-link registration.
//
//   pnpm --filter @beacon/web-viewer dev --host 127.0.0.1 --port 5181 --strictPort
//   pnpm --filter @beacon/desktop build
//   BEACON_QA_URL=http://127.0.0.1:5181 node scripts/Test-BeaconDesktop.mjs
/* global window, document, location, Notification */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { _electron as electron } from 'playwright';

const base = process.env.BEACON_QA_URL || 'http://127.0.0.1:5181';
assert(
  ['127.0.0.1', 'localhost'].includes(new URL(base).hostname),
  'Use a local web viewer; this smoke test must never reach a live service.',
);
const desktopRoot = path.resolve('apps/desktop');
const out = path.resolve('.beacon-dev/desktop-smoke');
rmSync(out, { force: true, recursive: true });
mkdirSync(out, { recursive: true });
const executablePath = createRequire(path.join(desktopRoot, 'package.json'))(
  'electron',
);

const app = await electron.launch({
  args: [desktopRoot],
  env: {
    ...process.env,
    BEACON_DESKTOP_ORIGIN: base,
    BEACON_DESKTOP_USER_DATA: path.join(out, 'user-data'),
  },
  executablePath,
});
const failures = [];
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(
      () => console.log('PASS', name),
      (error) => {
        failures.push(name);
        console.error('FAIL', name, '\n ', error.message);
      },
    );
}

try {
  // Record instead of opening the real browser or holding a power lock.
  await app.evaluate(({ powerSaveBlocker, shell }) => {
    globalThis.smoke = { blockers: [], opened: [] };
    shell.openExternal = async (url) => {
      globalThis.smoke.opened.push(url);
    };
    const start = powerSaveBlocker.start.bind(powerSaveBlocker);
    const stop = powerSaveBlocker.stop.bind(powerSaveBlocker);
    powerSaveBlocker.start = (type) => {
      const id = start(type);
      globalThis.smoke.blockers.push(['start', type]);
      return id;
    };
    powerSaveBlocker.stop = (id) => {
      globalThis.smoke.blockers.push(['stop']);
      return stop(id);
    };
  });
  const smoke = () => app.evaluate(() => globalThis.smoke);

  let signedIn = false;
  const exchanges = [];
  await app.context().route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/desktop/auth/google') {
      exchanges.push({
        body: request.postDataJSON(),
        headers: await request.allHeaders(),
      });
      signedIn = true;
      return route.fulfill({
        body: JSON.stringify({ redirect: '/', status: 'signedIn' }),
        contentType: 'application/json',
      });
    }
    if (pathname === '/api/auth/me' && signedIn)
      return route.fulfill({
        body: JSON.stringify({
          user: { email: 'owner@example.com', id: 'user-1' },
        }),
        contentType: 'application/json',
      });
    return route.fulfill({
      body: JSON.stringify({ error: 'Authentication required' }),
      contentType: 'application/json',
      status: pathname === '/api/auth/me' ? 401 : 404,
    });
  });

  const page = await app.firstWindow();
  await page.addInitScript(() => {
    localStorage.setItem('beacon.splash.seen.v1', 'true');
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page
    .getByRole('link', { name: /google/i })
    .first()
    .waitFor();

  await check('loads the web viewer itself', async () => {
    assert.equal(new URL(page.url()).origin, base);
    await page.screenshot({ path: path.join(out, 'desktop-landing.png') });
  });

  await check(
    'exposes only the frozen capture bridge, never Node',
    async () => {
      const surface = await page.evaluate(() => ({
        bridge: Object.keys(window.beaconDesktop ?? {}).sort(),
        frozen: Object.isFrozen(window.beaconDesktop),
        process: typeof window.process,
        require: typeof window.require,
        version: window.beaconDesktop?.version,
      }));
      assert.deepEqual(surface, {
        bridge: ['setCaptureActive', 'version'],
        frozen: true,
        process: 'undefined',
        require: 'undefined',
        version: 1,
      });
    },
  );

  await check('denies notifications and geolocation to the page', async () => {
    const state = await page.evaluate(async () => ({
      geolocation: (await navigator.permissions.query({ name: 'geolocation' }))
        .state,
      notification: Notification.permission,
    }));
    assert.notEqual(state.notification, 'granted');
    assert.notEqual(state.geolocation, 'granted');
  });

  await check(
    'opens other sites in the system browser, not the window',
    async () => {
      await page.evaluate(() => {
        location.href = 'https://example.com/';
      });
      await page.waitForTimeout(500);
      assert.equal(new URL(page.url()).origin, base);
      assert.deepEqual((await smoke()).opened, ['https://example.com/']);
    },
  );

  let challenge = '';
  await check(
    'starts Google sign-in in the system browser with PKCE',
    async () => {
      // The shell cancels navigations, which Playwright locators then wait on
      // forever; click from inside the page instead.
      await page.evaluate(() =>
        document.querySelector('a[href^="/api/auth/google"]').click(),
      );
      await page.waitForTimeout(500);
      assert.equal(new URL(page.url()).origin, base);
      const opened = new URL((await smoke()).opened.at(-1));
      assert.equal(
        `${opened.origin}${opened.pathname}`,
        `${base}/api/auth/google`,
      );
      assert.equal(opened.searchParams.get('platform'), 'desktop');
      challenge = opened.searchParams.get('challenge') ?? '';
      assert.match(challenge, /^[A-Za-z0-9_-]{43}$/);
    },
  );

  await check('completes the handoff with the matching verifier', async () => {
    const code = 'c'.repeat(43);
    await app.evaluate(({ app: electronApp }, link) => {
      electronApp.emit('open-url', { preventDefault() {} }, link);
    }, `beaconsecureview://auth/desktop?code=${code}`);
    await page.waitForTimeout(1500);
    assert.equal(exchanges.length, 1);
    const [{ body, headers }] = exchanges;
    assert.equal(body.code, code);
    assert.equal(
      createHash('sha256').update(body.verifier).digest('base64url'),
      challenge,
    );
    assert.equal(headers['x-beacon-desktop'], '1');
    assert.match(headers['content-type'], /^application\/json/);
  });

  await check('ignores a deep link it did not ask for', async () => {
    await app.evaluate(
      ({ app: electronApp }, link) => {
        electronApp.emit('open-url', { preventDefault() {} }, link);
      },
      `beaconsecureview://auth/desktop?code=${'d'.repeat(43)}`,
    );
    await page.waitForTimeout(800);
    assert.equal(exchanges.length, 1);
  });

  await check(
    'shows live capture in the tray and keeps the system awake',
    async () => {
      await page.evaluate(() => window.beaconDesktop.setCaptureActive(true));
      await page.waitForTimeout(200);
      assert.deepEqual((await smoke()).blockers, [
        ['start', 'prevent-app-suspension'],
      ]);
      await page.evaluate(() => window.beaconDesktop.setCaptureActive(false));
      await page.waitForTimeout(200);
      assert.deepEqual((await smoke()).blockers.at(-1), ['stop']);
    },
  );

  await check('closing the window hides Beacon to the tray', async () => {
    const state = await app.evaluate(({ BrowserWindow }) => {
      const [window] = BrowserWindow.getAllWindows();
      window.close();
      return {
        destroyed: window.isDestroyed(),
        visible: window.isVisible(),
        windows: BrowserWindow.getAllWindows().length,
      };
    });
    assert.deepEqual(state, { destroyed: false, visible: false, windows: 1 });
  });

  await check('a reload resets the capture indicator', async () => {
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].show(),
    );
    await page.evaluate(() => window.beaconDesktop.setCaptureActive(true));
    await page.waitForTimeout(200);
    await page.reload();
    await page.waitForTimeout(500);
    assert.deepEqual((await smoke()).blockers.at(-1), ['stop']);
  });
} finally {
  await app.close();
}

if (failures.length > 0) {
  console.error(`\n${failures.length} desktop smoke check(s) failed`);
  process.exit(1);
}
console.log(`\nAll desktop smoke checks passed. Screenshots: ${out}`);
