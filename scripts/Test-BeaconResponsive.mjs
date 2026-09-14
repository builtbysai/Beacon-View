// Run against a local Vite server. All API/media interactions are isolated fixtures.
/* global window, document, innerWidth, innerHeight, getComputedStyle, HTMLElement */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const modulePath = process.env.BEACON_PLAYWRIGHT_MODULE;
const { chromium } = modulePath ? require(modulePath) : require('playwright');
const base = process.env.BEACON_QA_URL || 'http://127.0.0.1:5178';
assert(
  ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname),
  'Use a local server; this audit must never submit to a live service.',
);
const out = path.resolve('.beacon-dev/responsive-audit');
mkdirSync(out, { recursive: true });
const now = new Date().toISOString();
const cameras = ['Hallway', 'Garden', 'Bedroom', 'Garage'].map((name, i) => ({
  id: `camera-${i}`,
  deviceId: `phone-${i}`,
  deviceName: `${name} phone`,
  name,
  online: i !== 3,
  platform: 'android',
  facing: 'rear',
  enabled: true,
  streaming: false,
  viewerCount: 0,
  lastSeenAt: now,
  credentialRevoked: false,
  capabilities: {},
  availability: 'idle',
  privacyMode: i === 2,
  sourceKey: 'rear',
}));
const devices = cameras.map((c) => ({
  id: c.deviceId,
  name: c.deviceName,
  platform: 'android',
  deviceType: 'phone',
  online: c.online,
  privacyMode: c.privacyMode,
  revoked: false,
  enabled: true,
  lastSeenAt: now,
  batteryPercent: 82,
  batteryCharging: true,
}));
const routes = {
  '/api/auth/me': {
    user: { id: 'responsive-qa', email: 'household@example.test' },
  },
  '/api/cameras': { cameras },
  '/api/devices': { devices },
  '/api/account/sessions': {
    sessions: [
      {
        id: 'session-1',
        current: true,
        createdAt: now,
        lastSeenAt: now,
        expiresAt: now,
      },
    ],
  },
  '/api/access-history': {
    events: [
      {
        success: true,
        deviceName: 'Hallway phone',
        actorEmail: 'household@example.test',
        occurredAt: now,
      },
    ],
  },
  '/api/motion-retention': { days: 30 },
  '/api/devices/phone-0/motion-settings': { cameras: [] },
  '/api/devices/phone-2/motion-settings': { cameras: [] },
  '/api/devices/phone-3/motion-settings': { cameras: [] },
  '/api/motion-events': {
    events: [
      {
        id: 'event-1',
        cameraId: 'camera-0',
        cameraName: 'Hallway',
        deviceName: 'Hallway phone',
        confidence: 0.62,
        occurredAt: now,
      },
    ],
    nextCursor: null,
  },
  '/api/diagnostics': { devices: [], cameras: [] },
  '/api/pairing-codes': { code: 'ABCD234567' },
};
const sizes = process.env.BEACON_QA_EXTENDED_ONLY
  ? []
  : [
      [320, 740],
      [390, 844],
      [768, 1024],
      [1280, 800],
      [2560, 1080],
    ];
const report = [];
(async () => {
  const browser = await chromium.launch({
    channel: process.env.BEACON_QA_CHANNEL || 'msedge',
    headless: true,
  });
  const context = await browser.newContext({
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  await context.addInitScript(() => {
    window.WebSocket = class {
      close() {}
      send() {}
    };
    // Prevent any local fixture from accessing real media.
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException('QA permission denied', 'NotAllowedError');
    };
    // This suite is about the sign-in form and the rest of the app, not the
    // one-time splash — mark it seen so every visit behaves like a
    // returning visitor. The splash itself gets a dedicated check below.
    localStorage.setItem('beacon.splash.seen.v1', 'true');
  });
  let signedIn = false;
  let scenario = 'normal';
  const unexpected = [],
    errors = [];
  await context.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    let data = routes[pathname];
    let status = data ? 200 : 404;
    if (pathname === '/api/auth/me' && !signedIn) {
      status = 401;
      data = { error: 'Authentication required' };
    }
    if (scenario === 'empty' && pathname === '/api/cameras')
      data = { cameras: [] };
    if (scenario === 'empty' && pathname === '/api/devices')
      data = { devices: [] };
    if (pathname === '/api/motion-events' && scenario === 'error') {
      status = 503;
      data = { error: 'Activity is temporarily unavailable. Please retry.' };
    }
    if (!data) unexpected.push(pathname);
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(data || { error: 'Unmocked endpoint' }),
    });
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  async function capture(name, fit = false) {
    const layout = await page.evaluate(() => {
      const root = document.documentElement;
      const clipped = [
        ...document.querySelectorAll(
          'button, input, select, textarea, a, summary',
        ),
      ]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          if (
            !r.width ||
            !r.height ||
            (el.closest('details:not([open])') && el.tagName !== 'SUMMARY')
          )
            return false;
          if (
            el.classList.contains('skip-link') ||
            (getComputedStyle(el).position === 'absolute' && r.width <= 1)
          )
            return false;
          return r.left < -1 || r.right > innerWidth + 1;
        })
        .map((el) => ({
          text: el.textContent?.trim().slice(0, 70),
          class: el.className,
        }));
      return {
        width: innerWidth,
        height: innerHeight,
        scrollWidth: root.scrollWidth,
        scrollHeight: root.scrollHeight,
        clipped,
      };
    });
    report.push({ name, ...layout });
    writeFileSync(
      path.join(out, 'results.json'),
      JSON.stringify({ browser: browser.version(), captures: report }, null, 2),
    );
    await page.screenshot({
      path: path.join(out, name + '.png'),
      fullPage: name !== 'sidebar-short-height',
    });
    assert(
      layout.scrollWidth <= layout.width + 1,
      `${name}: horizontal overflow ${JSON.stringify(layout)}`,
    );
    assert.deepEqual(layout.clipped, [], `${name}: clipped controls`);
    if (fit)
      assert(
        layout.scrollHeight <= layout.height + 1,
        `${name}: unnecessary vertical overflow (${layout.scrollHeight})`,
      );
    console.log('PASS', name, `${layout.scrollWidth}×${layout.scrollHeight}`);
  }
  async function assertMobileNavigationClear(name) {
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );
    await page.waitForTimeout(80);
    const positions = await page.evaluate(() => {
      const navigation = document.querySelector('.sidebar');
      const workspace = document.querySelector('.workspace');
      const lastContent = workspace?.lastElementChild;
      if (
        !(navigation instanceof HTMLElement) ||
        !(lastContent instanceof HTMLElement)
      )
        throw new Error('Mobile navigation or page content was not found');
      return {
        contentBottom: lastContent.getBoundingClientRect().bottom,
        navigationTop: navigation.getBoundingClientRect().top,
      };
    });
    assert(
      positions.contentBottom <= positions.navigationTop + 1,
      `${name}: final content is obscured by mobile navigation ${JSON.stringify(positions)}`,
    );
    console.log('PASS', name, 'final content clears mobile navigation');
  }
  async function assertCompactMobileHeaderAction(name) {
    const size = await page
      .locator('.page-heading .add-camera-button')
      .evaluate((button) => ({
        width: button.getBoundingClientRect().width,
        height: button.getBoundingClientRect().height,
      }));
    assert(
      size.width <= 48 && size.height <= 48,
      `${name}: mobile Add camera action is not compact ${JSON.stringify(size)}`,
    );
    console.log(
      'PASS',
      name,
      `${Math.round(size.width)}×${Math.round(size.height)}`,
    );
  }
  async function assertAuthCardFits(name) {
    const dimensions = await page.locator('.sign-in-card').evaluate((card) => ({
      clientHeight: card.clientHeight,
      scrollHeight: card.scrollHeight,
    }));
    assert(
      dimensions.scrollHeight <= dimensions.clientHeight + 1,
      `${name}: auth card has unnecessary internal scrolling ${JSON.stringify(dimensions)}`,
    );
    console.log('PASS', name, 'auth card fits without internal scrolling');
  }
  async function visit(route, selector) {
    await page.goto(base + route);
    await page.locator(selector).first().waitFor();
  }
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    signedIn = false;
    await visit('/', '.sign-in-card');
    await capture(`auth-${width}`, true);
    await assertAuthCardFits(`auth-card-fit-${width}`);
    await page.getByRole('button', { name: 'Forgot password?' }).click();
    await page.getByRole('status').waitFor();
    const recoveryDocumentHeight = await page.evaluate(
      () => document.documentElement.scrollHeight,
    );
    assert(
      recoveryDocumentHeight <= height + 1,
      `auth-recovery-${width}: recovery guidance causes unnecessary page scrolling (${recoveryDocumentHeight})`,
    );
    await assertAuthCardFits(`auth-recovery-card-fit-${width}`);
    await page.getByRole('button', { name: 'Forgot password?' }).click();
    await page.getByLabel('Password', { exact: true }).fill('local-test-only');
    await page.getByRole('button', { name: 'Show password' }).click();
    assert.equal(
      await page.getByLabel('Password', { exact: true }).getAttribute('type'),
      'text',
    );
    await page
      .getByRole('button', { name: 'Create a password account' })
      .click();
    await capture(`register-${width}`);
    await visit('/?googleSignIn=linkRequired', '[role=alert]');
    await capture(`oauth-collision-${width}`);
    signedIn = true;
    for (const [route, selector] of [
      ['/', '.home-dashboard'],
      ['/cameras', '.camera-tile-grid'],
      ['/events', '#motion-events-title'],
      ['/settings', '.settings-layout'],
      ['/camera-mode', '.setup-options'],
      ['/devices/phone-0', '.device-health'],
      ['/devices/phone-2', '.device-guidance.attention'],
      ['/devices/phone-3', '.device-guidance.attention'],
      ['/contact', '.contact-layout'],
      ['/trust', '.trust-page'],
      ['/pair?code=ABCD234567', '.pair-link-code'],
    ]) {
      await visit(route, selector);
      const routeName = route.split('?')[0].replaceAll('/', '-') || 'home';
      await capture(`${routeName}-${width}`, route === '/' && width >= 1280);
      if (
        (route === '/devices/phone-2' || route === '/devices/phone-3') &&
        (width === 320 || width === 1280)
      ) {
        await page.locator('.device-guidance > summary').click();
        await capture(`${routeName}-guidance-expanded-${width}`);
      }
    }
    if (width <= 760) {
      await visit('/devices/phone-3', '.device-guidance.attention');
      await assertMobileNavigationClear(`mobile-nav-clear-${width}`);
      await assertCompactMobileHeaderAction(`mobile-header-action-${width}`);
    }
    cameras.forEach((c) => {
      c.privacyMode = true;
    });
    await visit('/cameras', '.camera-tile-grid');
    await capture(`cameras-privacy-${width}`);

    await visit('/cameras/camera-0', '.live-surface');
    await capture(`cameras-camera-0-${width}`, width >= 1280);
    cameras.forEach((c, i) => {
      c.privacyMode = i === 2;
    });
    await visit('/', '.home-dashboard');
    if (width > 760 && width <= 1024) {
      // Tablet-portrait widths default to the compact icon rail (no stored
      // preference yet in this browser context) — confirm that explicitly
      // before the generic toggle test below forces it back to expanded.
      assert.equal(
        await page.getByRole('button', { name: 'Expand sidebar' }).isVisible(),
        true,
        `${width}: tablet width must default to a collapsed sidebar rail`,
      );
      assert.equal(
        await page.locator('nav button span').first().isVisible(),
        false,
        `${width}: tablet default rail must hide nav labels`,
      );
      await capture(`tablet-default-rail-${width}`);
    }
    if (width > 760) {
      // Bring the page to the front before keyboard interaction: after many
      // rapid full-page navigations (including a detour through the live
      // view's entirely different page shell), headless Edge can leave the
      // tab's focus state in a way that makes a .focus()-triggered tooltip
      // flaky immediately afterward even though the same interaction is
      // reliable in isolation — a short settle wait avoids that false
      // negative without weakening what the assertions below check.
      await page.bringToFront();
      await page.waitForTimeout(150);
      const expandToggle = page.getByRole('button', { name: 'Expand sidebar' });
      if (await expandToggle.isVisible()) await expandToggle.click();
      const toggle = page.getByRole('button', { name: 'Collapse sidebar' });
      await toggle.focus();
      await page.keyboard.press('Enter');
      await page.waitForTimeout(150);
      await page.getByRole('button', { name: 'Home', exact: true }).focus();
      await page.getByRole('tooltip', { name: 'Home' }).waitFor();
      await capture(`sidebar-collapsed-${width}`);
      await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('tooltip').count(), 0);
      await page.reload();
      await page.getByRole('button', { name: 'Expand sidebar' }).waitFor();
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(
        await page.getByRole('button', { name: 'Expand sidebar' }).isVisible(),
        false,
      );
      assert.equal(
        await page.locator('nav button span').first().isVisible(),
        true,
      );
      await page.setViewportSize({ width, height });
      await page.getByRole('button', { name: 'Expand sidebar' }).click();
    }
    scenario = 'empty';
    await visit('/', '.home-dashboard');
    await capture(`empty-home-${width}`, width >= 1280);
    scenario = 'error';
    await visit('/events', '[role=alert]');
    await capture(`activity-error-${width}`);
    scenario = 'normal';
  }
  // Expanded forms, modal scrolling, denied permissions and long content.
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [1280, 800],
  ]) {
    await page.setViewportSize({ width, height });
    signedIn = true;
    await visit('/camera-mode', '.setup-options');
    await page.getByRole('button', { name: 'Pair Android device' }).click();
    await page.getByLabel('Beacon pairing QR code').waitFor();
    await capture(`pair-modal-${width}`);
    const modal = page.getByRole('dialog');
    const modalState = await modal.evaluate((dialog) => ({
      modal: dialog.matches(':modal'),
      focusContained: dialog.contains(document.activeElement),
    }));
    assert.deepEqual(
      modalState,
      { modal: true, focusContained: true },
      'Pairing dialog must take focus and make the page behind it inert',
    );
    const box = await modal.boundingBox();
    assert(
      box.y >= 0 && box.y + box.height <= height + 1,
      'Modal must scroll inside viewport',
    );
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page
      .getByRole('button', { name: 'Use this browser as a camera' })
      .click();
    await page.getByRole('button', { name: 'Allow and find cameras' }).click();
    await page.getByRole('alert').waitFor();
    await capture(`camera-permission-denied-${width}`);
    const oldName = cameras[0].name,
      oldDeviceName = devices[0].name;
    cameras[0].name = 'LongCameraName'.repeat(7);
    cameras[0].deviceName = 'LongDeviceName'.repeat(7);
    devices[0].name = cameras[0].deviceName;
    await visit('/cameras', '.camera-tile-grid');
    await capture(`long-camera-names-${width}`);
    await visit('/devices/phone-0', '.device-health');
    await page.getByText('Device settings', { exact: true }).click();
    await capture(`device-settings-expanded-${width}`);
    for (const [route, selector] of [
      ['/devices', '.device-list'],
      ['/diagnostics', '.workspace'],
      ['/account-deletion', '.contact-layout'],
      ['/auth/mobile', '#mobile-auth-title'],
      ['/pair?code=invalid', '#pair-link-title'],
    ]) {
      await visit(route, selector);
      await capture(
        `extra-${route.split('?')[0].replaceAll('/', '-')}-${width}`,
      );
    }
    cameras[0].name = oldName;
    cameras[0].deviceName = oldDeviceName;
    devices[0].name = oldDeviceName;
  }
  await page.setViewportSize({ width: 1280, height: 500 });
  await visit('/', '.home-dashboard');
  await page
    .getByRole('button', { name: 'household@example.test', exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).focus();
  await capture('sidebar-short-height');
  const signoutBox = await page
    .getByRole('menuitem', { name: 'Sign out', exact: true })
    .boundingBox();
  assert(
    signoutBox.y >= 0 && signoutBox.y + signoutBox.height <= 501,
    'Keyboard must reach sign-out in a short sidebar ' +
      JSON.stringify(signoutBox),
  );
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: 'dark' });
  signedIn = false;
  await visit('/', '.sign-in-card');
  await capture('auth-dark', true);
  signedIn = true;
  await visit('/settings', '.settings-layout');
  await capture('settings-dark');
  await page.setViewportSize({ width: 320, height: 568 });
  signedIn = false;
  await visit('/', '.sign-in-card');
  await page.addStyleTag({ content: 'html { font-size: 200%; }' });
  await capture('auth-large-type-short');

  // One-time splash: verify it appears for a first-time visitor and hands
  // off to the sign-in form after "Get started", on both a phone and a
  // laptop width, and that it's remembered as seen afterward. The context's
  // first addInitScript (above) marks the splash seen on every navigation
  // for the rest of this suite — register a second one that runs after it
  // and undoes that, so navigations from here on start "unseen" again.
  await context.addInitScript(() => {
    localStorage.removeItem('beacon.splash.seen.v1');
  });
  for (const [width, height] of [
    [390, 844],
    [1280, 800],
  ]) {
    await page.setViewportSize({ width, height });
    signedIn = false;
    await visit('/', '.splash-cta');
    await capture(`splash-${width}`, true);
    await page.locator('.splash-cta').click();
    await page.locator('.sign-in-card').first().waitFor();
    const seen = await page.evaluate(() =>
      localStorage.getItem('beacon.splash.seen.v1'),
    );
    assert.equal(seen, 'true', 'Continuing past the splash must mark it seen');
  }

  assert.deepEqual(errors, []);
  assert.deepEqual(unexpected, []);
  console.log(
    'PASS',
    report.length,
    'captures; no page errors or unexpected API calls',
  );
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
