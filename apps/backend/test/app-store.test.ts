import { afterEach, describe, expect, it } from 'vitest';

import { createPostgresStore } from '../src/app.js';
import { parseConfig } from '../src/config.js';
import type { PostgresStore } from '../src/store.js';

const stores: PostgresStore[] = [];

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close()));
});

describe('production store configuration', () => {
  it('passes Google Drive and notification encryption keys to the store', () => {
    // Distinct keys: configuration refuses to reuse one value for two secrets.
    const key = (fill: number) => Buffer.alloc(32, fill).toString('base64url');
    const config = parseConfig({
      ALLOW_INSECURE_LOCAL_DEV: 'true',
      DATABASE_URL: 'postgresql://beacon:test@127.0.0.1:5432/beacon_test',
      GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY: key(7),
      GOOGLE_OAUTH_CLIENT_ID: 'client-id',
      GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret',
      GOOGLE_OAUTH_REDIRECT_URI:
        'http://127.0.0.1:3000/api/auth/google/callback',
      NOTIFICATION_ENCRYPTION_KEY: key(8),
      NOTIFICATION_FINGERPRINT_KEY: key(9),
      TURN_SHARED_SECRET: 'test-turn-shared-secret-at-least-32-characters',
      WEB_ORIGIN: 'http://127.0.0.1:3000',
    });

    const store = createPostgresStore(config);
    stores.push(store);

    expect(store.googleDriveConfigured()).toBe(true);
    expect(store.notificationsConfigured()).toBe(true);
  });
});
