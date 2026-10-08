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
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
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
  await app.evaluate(({ Notification, powerSaveBlocker, shell }) => {
    globalThis.smoke = { blockers: [], notifications: [], opened: [] };
    Notification.prototype.show = function show() {
      globalThis.smoke.notifications.push({
        body: this.body,
        title: this.title,
      });
    };
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
    // Never open this machine's real camera from a fixture-only test.
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException('Test camera', 'NotAllowedError'));
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
        bridge: [
          'getAutostart',
          'setAutostart',
          'setCameraActivity',
          'setCameraResume',
          'setCaptureActive',
          'showAlert',
          'version',
        ],
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

  await check('keeps the computer awake for a standby camera too', async () => {
    const before = (await smoke()).blockers.length;
    await page.evaluate(() =>
      window.beaconDesktop.setCameraActivity('standby'),
    );
    await page.waitForTimeout(150);
    await page.evaluate(() => window.beaconDesktop.setCameraActivity('live'));
    await page.waitForTimeout(150);
    assert.deepEqual((await smoke()).blockers.slice(before), [
      ['start', 'prevent-app-suspension'],
    ]);
    await page.evaluate(() => window.beaconDesktop.setCameraActivity('off'));
    await page.waitForTimeout(150);
    assert.deepEqual((await smoke()).blockers.at(-1), ['stop']);
  });

  await check('refuses start-at-sign-in in a development build', async () => {
    const result = await page.evaluate(async () => ({
      after: await window.beaconDesktop.setAutostart(true),
      before: await window.beaconDesktop.getAutostart(),
    }));
    assert.deepEqual(result, { after: false, before: false });
  });

  await check('remembers only a valid Camera Mode resume path', async () => {
    const prefs = path.join(out, 'user-data', 'desktop-preferences.json');
    const resume = '/camera-mode/setup?autostart=1&mic=0&power=standby';
    await page.evaluate(
      (value) => window.beaconDesktop.setCameraResume(value),
      resume,
    );
    await page.waitForTimeout(300);
    assert.equal(
      JSON.parse(readFileSync(prefs, 'utf8')).cameraResumePath,
      resume,
    );
    await page.evaluate(() =>
      window.beaconDesktop.setCameraResume('https://evil.example/'),
    );
    await page.waitForTimeout(300);
    assert.equal(
      JSON.parse(readFileSync(prefs, 'utf8')).cameraResumePath,
      resume,
    );
  });

  await check('shows each desktop alert once, with generic copy', async () => {
    const before = (await smoke()).notifications.length;
    await page.evaluate(() => {
      const alert = {
        category: 'motion',
        eventId: 'event-1',
        route: '/activity',
      };
      window.beaconDesktop.showAlert(alert);
      window.beaconDesktop.showAlert(alert);
      window.beaconDesktop.showAlert({
        category: 'motion',
        eventId: 'event-2',
        route: 'https://evil.example',
      });
    });
    await page.waitForTimeout(300);
    assert.deepEqual((await smoke()).notifications.slice(before), [
      { body: 'Beacon detected activity.', title: 'Beacon' },
    ]);
  });

  await check('opens a camera setup link in the web pairing page', async () => {
    // The pairing page strips the one-time code from the address bar as
    // soon as it loads, so check the navigation the app made instead.
    const navigation = page.waitForRequest(
      (request) =>
        request.isNavigationRequest() &&
        request.url().includes('/camera-mode/setup'),
    );
    await app.evaluate(({ app: electronApp }, link) => {
      electronApp.emit('open-url', { preventDefault() {} }, link);
    }, 'beaconsecureview://camera/setup?code=ABCDEFGHJK&power=standby');
    const url = new URL((await navigation).url());
    assert.equal(url.searchParams.get('autostart'), '1');
    assert.equal(url.searchParams.get('code'), 'ABCDEFGHJK');
    assert.equal(url.searchParams.get('power'), 'standby');
    await page.waitForURL(/\/camera-mode\/setup/);
    await page.waitForLoadState('load');
  });

  await check(
    'floats a watched camera when the window closes to the tray, and docks it on return',
    async () => {
      // A playing "live view" video, marked the way the page marks it.
      await page.evaluate(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 180;
        const context = canvas.getContext('2d');
        let frame = 0;
        setInterval(() => {
          context.fillStyle = frame++ % 2 ? '#0ea5e9' : '#071b31';
          context.fillRect(0, 0, 320, 180);
        }, 50);
        const video = document.createElement('video');
        video.id = 'smoke-live';
        video.muted = true;
        video.setAttribute('autopictureinpicture', '');
        video.srcObject = canvas.captureStream(20);
        document.body.append(video);
        await video.play();
      });
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].close(),
      );
      await page.waitForFunction(
        () => document.pictureInPictureElement?.id === 'smoke-live',
        null,
        { timeout: 10_000 },
      );
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].show(),
      );
      await page.waitForFunction(
        () => !document.pictureInPictureElement,
        null,
        { timeout: 10_000 },
      );
      await page.evaluate(() =>
        document.getElementById('smoke-live')?.remove(),
      );
    },
  );

  await check(
    'an outage reconnects to the page that failed, not Home',
    async () => {
      const failing = `${base}/camera-mode/setup?autostart=1`;
      const offline = (route) => route.abort('internetdisconnected');
      await app.context().route('**/camera-mode/setup**', offline);
      await page.goto(failing).catch(() => undefined);
      await page.waitForURL(/offline.html/);
      const retry = await page.getByRole('link', { name: 'Try again' });
      assert.equal(await retry.getAttribute('href'), failing);
      await app.context().unroute('**/camera-mode/setup**', offline);
      await page.goto(`${base}/`);
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

// A computer set up as a camera reopens Camera Mode when Beacon starts.
const relaunched = await electron.launch({
  args: [desktopRoot],
  env: {
    ...process.env,
    BEACON_DESKTOP_ORIGIN: base,
    BEACON_DESKTOP_USER_DATA: path.join(out, 'user-data'),
  },
  executablePath,
});
try {
  await check('resumes Camera Mode at startup after a restart', async () => {
    await relaunched.context().route('**/api/**', (route) =>
      route.fulfill({
        body: '{}',
        contentType: 'application/json',
        status: 401,
      }),
    );
    const window = await relaunched.firstWindow();
    await window.waitForURL(/\/camera-mode\/setup/);
    assert.equal(
      new URL(window.url()).search,
      '?autostart=1&mic=0&power=standby',
    );
  });
} finally {
  await relaunched.close();
}

if (failures.length > 0) {
  console.error(`\n${failures.length} desktop smoke check(s) failed`);
  process.exit(1);
}
console.log(`\nAll desktop smoke checks passed. Screenshots: ${out}`);
