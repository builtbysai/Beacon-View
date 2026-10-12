import { randomBytes } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DRIVE_MAX_REMINDERS,
  DRIVE_REMINDER_GAP_MS,
  runDriveExpirySweep,
} from '../src/drive-expiry-job.js';
import type { DriveHealth } from '../src/drive-connection-health.js';
import { PostgresStore } from '../src/store.js';
import { resetTestDatabase, testDatabaseUrl } from './test-database.js';

const databaseUrl = testDatabaseUrl();
const store = databaseUrl
  ? new PostgresStore(
      databaseUrl,
      {
        encryptionKey: randomBytes(32).toString('base64url'),
        fingerprintKey: randomBytes(32).toString('base64url'),
      },
      randomBytes(32).toString('base64url'),
    )
  : null;

const config = {
  RESEND_API_KEY: 'test-key',
  RESEND_FROM: 'Beacon <beacon@example.com>',
  WEB_ORIGIN: 'https://beacon.example',
};
const logger = { info: vi.fn(), warn: vi.fn() };

async function connectedOwner(email: string) {
  const owner = await store!.createAccount(
    email,
    'irrelevant-test-hash',
    '127.0.0.1',
  );
  await store!.saveGoogleDriveConnection({
    providerEmail: email,
    refreshToken: 'fake-refresh-token',
    scopes: 'drive.file',
    userId: owner.id,
  });
  return owner;
}

describe.skipIf(!store)('Google Drive expiry reminders (ADR 0116)', () => {
  beforeEach(async () => resetTestDatabase(store!.pool));
  afterAll(async () => store?.close());

  it('checks live connections and reminds an owner when it expires, then at a spacing, then stops', async () => {
    const owner = await connectedOwner('drive-owner@example.com');
    const checked: string[] = [];
    // Google rejects the token on the first check, as DriveHealth would after marking it expired.
    const health = {
      problem: vi.fn(async (userId: string) => {
        checked.push(userId);
        await store!.markGoogleDriveConnectionExpired(userId);
        return 'drive_reconnect_required';
      }),
    } as unknown as DriveHealth;
    const send = vi.fn().mockResolvedValue(undefined);
    const start = new Date('2026-10-12T12:00:00Z');

    expect(
      await runDriveExpirySweep(store!, health, config, logger, start, send),
    ).toBe(1);
    expect(checked).toEqual([owner.id]);
    expect(send).toHaveBeenCalledWith(config, 'drive-owner@example.com');

    // Nothing more until the spacing has passed.
    const soon = new Date(start.getTime() + DRIVE_REMINDER_GAP_MS - 60_000);
    expect(
      await runDriveExpirySweep(store!, health, config, logger, soon, send),
    ).toBe(0);

    let at = start;
    let total = 1;
    for (let round = 0; round < DRIVE_MAX_REMINDERS + 2; round++) {
      at = new Date(at.getTime() + DRIVE_REMINDER_GAP_MS);
      total += await runDriveExpirySweep(
        store!,
        health,
        config,
        logger,
        at,
        send,
      );
    }
    expect(total).toBe(DRIVE_MAX_REMINDERS);
    expect(send).toHaveBeenCalledTimes(DRIVE_MAX_REMINDERS);
  });

  it('starts over after the owner reconnects, and retries a failed email on the next sweep', async () => {
    const owner = await connectedOwner('drive-retry@example.com');
    await store!.markGoogleDriveConnectionExpired(owner.id);
    const health = {
      problem: vi.fn().mockResolvedValue(null),
    } as unknown as DriveHealth;
    const now = new Date('2026-10-12T12:00:00Z');

    const failing = vi.fn().mockRejectedValue(new Error('provider down'));
    expect(
      await runDriveExpirySweep(store!, health, config, logger, now, failing),
    ).toBe(0);
    const working = vi.fn().mockResolvedValue(undefined);
    expect(
      await runDriveExpirySweep(store!, health, config, logger, now, working),
    ).toBe(1);

    // Reconnecting clears the expiry and the reminder history.
    await store!.saveGoogleDriveConnection({
      providerEmail: 'drive-retry@example.com',
      refreshToken: 'new-token',
      scopes: 'drive.file',
      userId: owner.id,
    });
    expect(
      await runDriveExpirySweep(
        store!,
        health,
        config,
        logger,
        new Date(now.getTime() + DRIVE_REMINDER_GAP_MS),
        working,
      ),
    ).toBe(0);
    await store!.markGoogleDriveConnectionExpired(owner.id);
    expect(
      await runDriveExpirySweep(
        store!,
        health,
        config,
        logger,
        new Date(now.getTime() + DRIVE_REMINDER_GAP_MS),
        working,
      ),
    ).toBe(1);
  });

  it('sends nothing when email is not configured', async () => {
    const owner = await connectedOwner('drive-noemail@example.com');
    await store!.markGoogleDriveConnectionExpired(owner.id);
    const health = {
      problem: vi.fn().mockResolvedValue(null),
    } as unknown as DriveHealth;
    const send = vi.fn();
    expect(
      await runDriveExpirySweep(
        store!,
        health,
        { WEB_ORIGIN: config.WEB_ORIGIN },
        logger,
        new Date(),
        send,
      ),
    ).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});
