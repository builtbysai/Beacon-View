// Run against a local Vite server. All API/media interactions are isolated fixtures.
/* global window, document, innerWidth, innerHeight, getComputedStyle */
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
import { cameras, devices, now, routes } from './qa-fixtures.mjs';
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
          // Inert or aria-hidden content (e.g. the closed mobile drawer)
          // is deliberately off-screen and unreachable, not clipped.
          if (el.closest('[inert], [aria-hidden="true"]')) return false;
          // Controls inside a horizontally scrolling strip (e.g. mobile
          // filter pills) are reachable by scrolling; the strip itself must
          // still fit the viewport, which its own ancestors are checked for.
          for (let node = el.parentElement; node; node = node.parentElement) {
            const overflowX = getComputedStyle(node).overflowX;
            if (
              (overflowX === 'auto' || overflowX === 'scroll') &&
              node.scrollWidth > node.clientWidth
            ) {
              const strip = node.getBoundingClientRect();
              if (strip.left >= -1 && strip.right <= innerWidth + 1)
                return false;
            }
          }
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
  async function assertCompactMobileHeaderAction(name) {
    // The mobile top bar keeps a labelled "Add camera" action (it was once
    // an icon-only button); it must stay a usable touch target and fit the
    // bar, which capture() separately checks for clipping.
    const size = await page
      .locator('.app-topbar-actions')
      .getByRole('button', { name: 'Add camera' })
      .evaluate((button) => ({
        width: button.getBoundingClientRect().width,
        height: button.getBoundingClientRect().height,
      }));
    assert(
      // WCAG 2.2 AA target size (2.5.8) minimum is 24 CSS px.
      size.height >= 24 &&
        size.width >= 24 &&
        size.width <= innerWidthAtCapture(),
      `${name}: mobile Add camera action is not a usable touch target ${JSON.stringify(size)}`,
    );
    console.log(
      'PASS',
      name,
      `${Math.round(size.width)}×${Math.round(size.height)}`,
    );
  }
  function innerWidthAtCapture() {
    return page.viewportSize()?.width ?? Infinity;
  }
  async function assertAuthCardFits(name) {
    const dimensions = await page
      .locator('main.auth .card')
      .evaluate((card) => ({
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
    cameras.forEach((camera, index) => {
      camera.privacyMode = index === 2;
    });
    await page.setViewportSize({ width, height });
    signedIn = false;
    await visit('/', 'main.auth .card');
    await capture(`auth-${width}`, true);
    await assertAuthCardFits(`auth-card-fit-${width}`);
    await page.getByRole('button', { name: 'Forgot password?' }).click();
    await page.getByLabel('Email', { exact: true }).waitFor();
    const recoveryDocumentHeight = await page.evaluate(
      () => document.documentElement.scrollHeight,
    );
    assert(
      recoveryDocumentHeight <= height + 1,
      `auth-recovery-${width}: recovery guidance causes unnecessary page scrolling (${recoveryDocumentHeight})`,
    );
    await assertAuthCardFits(`auth-recovery-card-fit-${width}`);
    await page.getByRole('button', { name: '← Back to sign in' }).click();
    await page.getByLabel('Password', { exact: true }).fill('local-test-only');
    await page.getByRole('button', { name: 'Show password' }).click();
    assert.equal(
      await page.getByLabel('Password', { exact: true }).getAttribute('type'),
      'text',
    );
    await page.getByRole('button', { name: 'Create an account' }).click();
    await capture(`register-${width}`);
    await visit('/?googleSignIn=linkRequired', '[role=alert]');
    await capture(`oauth-collision-${width}`);
    signedIn = true;
    for (const [route, selector] of [
      ['/', '.home-dashboard'],
      ['/cameras', '.camera-tile-grid'],
      ['/events', '.activity-v3-container'],
      ['/settings', '.settings-shell'],
      ['/camera-mode', '.add-device-grid'],
      ['/contact', '#form'],
      ['/trust', '.commitments'],
      ['/pair?code=ABCD234567', '.pair-link-code'],
    ]) {
      await visit(route, selector);
      const routeName = route.split('?')[0].replaceAll('/', '-') || 'home';
      await capture(`${routeName}-${width}`, route === '/' && width >= 1280);
      // The contact page was redesigned (contact-v4) as a full page with
      // help options above the form, so it scrolls by design; capture()
      // still enforces no horizontal overflow and no clipped controls.
    }
    if (width <= 768) {
      // Mobile navigation is an off-canvas drawer (inert when closed), not
      // the former fixed bottom bar, so there is no bar to obscure content.
      await visit('/cameras', '.camera-tile-grid');
      await assertCompactMobileHeaderAction(`mobile-header-action-${width}`);
    }
    cameras.forEach((c) => {
      c.privacyMode = true;
    });
    await visit('/cameras', '.camera-tile-grid');
    await capture(`cameras-privacy-${width}`);

    cameras[0].privacyMode = false;
    cameras.push({
      ...cameras[0],
      id: 'camera-0-front',
      name: 'Front',
      facing: 'front',
      sourceKey: 'front',
    });
    await visit('/cameras/camera-0', '.live-shell');
    await capture(`cameras-camera-0-${width}`, width >= 1280);
    // The control bar keeps Audio, Talk and More; everything else is in the
    // More menu, which opens upward inside the live surface and must fit.
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('menu').waitFor();
    const menuBox = await page.getByRole('menu').boundingBox();
    assert(
      menuBox &&
        menuBox.x >= 0 &&
        menuBox.y >= 0 &&
        menuBox.x + menuBox.width <= width &&
        menuBox.y + menuBox.height <= page.viewportSize().height,
      `live-more-${width}: the More menu leaves the screen ${JSON.stringify(menuBox)}`,
    );
    await capture(`live-more-${width}`);
    await page.keyboard.press('Escape');
    if (width === 390 || width === 1280) {
      const livePath = new URL(page.url()).pathname;
      const liveShell = await page.locator('.live-shell').elementHandle();
      await page.getByRole('button', { name: 'Camera settings' }).click();
      await page.getByRole('dialog').waitFor();
      // ADR 0056: the sheet gets its own deep-linkable URL, but the live
      // viewer underneath must stay mounted so the stream is not torn down.
      assert.equal(
        await liveShell.evaluate((element) => element.isConnected),
        true,
        'Live settings must not unmount the active stream',
      );
      await capture(`live-settings-${width}`, true);
      await page.getByRole('button', { name: 'Close camera settings' }).click();
      assert.equal(new URL(page.url()).pathname, livePath);
    }
    cameras.pop();
    cameras.forEach((c, i) => {
      c.privacyMode = i === 2;
    });
    await visit('/', '.home-dashboard');
    // The sidebar no longer defaults to a tablet icon rail; Sidebar.tsx
    // treats <= 768px as mobile (drawer) and everything wider as desktop.
    if (width > 768) {
      // Bring the page to the front before keyboard interaction: after many
      // rapid full-page navigations (including a detour through the live
      // view's entirely different page shell), headless Edge can leave the
      // tab's focus state in a way that makes a .focus()-triggered tooltip
      // flaky immediately afterward even though the same interaction is
      // reliable in isolation — a short settle wait avoids that false
      // negative without weakening what the assertions below check.
      await page.bringToFront();
      await page.waitForTimeout(150);
      // The toggle keeps one accessible name and reports its state through
      // aria-expanded; the sidebar exposes the same state as data-state.
      const toggle = page
        .locator('.app-topbar')
        .getByRole('button', { name: 'Toggle Sidebar' });
      const sidebarState = () =>
        page.locator('#primary-sidebar').getAttribute('data-state');
      if ((await sidebarState()) === 'collapsed') await toggle.click();
      assert.equal(await sidebarState(), 'expanded');
      await toggle.focus();
      await page.keyboard.press('Enter');
      await page.waitForTimeout(150);
      assert.equal(await sidebarState(), 'collapsed');
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      await page.getByRole('button', { name: 'Home', exact: true }).focus();
      await page.getByRole('tooltip', { name: 'Home' }).waitFor();
      await capture(`sidebar-collapsed-${width}`);
      await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('tooltip').count(), 0);
      await page.reload();
      await page.locator('#primary-sidebar').waitFor();
      assert.equal(await sidebarState(), 'collapsed', 'preference persists');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(150);
      assert.equal(
        await sidebarState(),
        'closed',
        'phones use the closed drawer regardless of the desktop preference',
      );
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(150);
      await toggle.click();
      assert.equal(await sidebarState(), 'expanded');
    }
    scenario = 'empty';
    await visit('/', '.dash-empty');
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
    await visit('/camera-mode', '.add-device-grid');
    await page.getByRole('button', { name: 'Pair a device →' }).click();
    await page.getByRole('dialog').waitFor();
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
    await page.getByRole('button', { name: 'Use this device →' }).click();
    await page.getByRole('button', { name: 'Allow camera access' }).click();
    await page.getByRole('alert').waitFor();
    await capture(`camera-permission-denied-${width}`);
    const oldName = cameras[0].name,
      oldDeviceName = devices[0].name;
    cameras[0].name = 'LongCameraName'.repeat(7);
    cameras[0].deviceName = 'LongDeviceName'.repeat(7);
    devices[0].name = cameras[0].deviceName;
    await visit('/cameras', '.camera-tile-grid');
    await capture(`long-camera-names-${width}`);
    for (const [route, selector] of [
      ['/cameras', '.pending-device-list'],
      ['/diagnostics', '#main-content'],
      ['/account-deletion', '#form'],
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
    .locator('.app-topbar')
    .getByRole('button', { name: 'Toggle Sidebar' })
    .click();
  await page
    .getByRole('button', {
      name: 'Open account menu for household@example.test',
      exact: true,
    })
    .click();
  await page
    .getByRole('menuitem', { name: 'Trust & privacy', exact: true })
    .waitFor();
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).focus();
  await capture('sidebar-collapsed-account-short-height');
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
  await visit('/', 'main.auth .card');
  await capture('auth-dark', true);
  signedIn = true;
  await visit('/settings', '.settings-shell');
  await capture('settings-dark');
  await page.setViewportSize({ width: 320, height: 568 });
  signedIn = false;
  await visit('/', 'main.auth .card');
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
    // The splash is now the full landing page (splash-v4), which scrolls by
    // design; its primary call to action continues to sign-in.
    await visit('/', '.splash-v4 .ctas');
    await capture(`splash-${width}`);
    await page
      .locator('.splash-v4 .ctas')
      .getByRole('button', { name: /Get started/ })
      .click();
    await page.locator('main.auth .card').first().waitFor();
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
