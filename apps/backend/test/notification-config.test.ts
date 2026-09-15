import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { parseConfig } from '../src/config.js';

const base = {
  ALLOW_INSECURE_LOCAL_DEV: 'true',
  DATABASE_URL: 'postgresql://beacon:password@127.0.0.1:5432/beacon_test',
  TURN_SHARED_SECRET: 'a-secure-test-secret-that-is-long-enough',
};

describe('notification configuration', () => {
  it('requires encryption keys when a provider is configured', () => {
    expect(() =>
      parseConfig({ ...base, FIREBASE_PROJECT_ID: 'beacon' }),
    ).toThrow(
      'Notification provider configuration requires both notification keys',
    );
  });

  it('requires complete FCM and Web Push provider groups', () => {
    const keys = {
      NOTIFICATION_ENCRYPTION_KEY: randomBytes(32).toString('base64url'),
      NOTIFICATION_FINGERPRINT_KEY: randomBytes(32).toString('base64url'),
    };
    expect(() =>
      parseConfig({ ...base, ...keys, FIREBASE_PROJECT_ID: 'beacon' }),
    ).toThrow(
      'Firebase project ID and application credentials path must be configured together',
    );
    expect(() =>
      parseConfig({
        ...base,
        ...keys,
        WEB_PUSH_VAPID_PUBLIC_KEY: 'public-key-value-long-enough',
      }),
    ).toThrow(
      'Web Push public key, private key, and subject must be configured together',
    );
  });

  it('accepts bounded offline grace and rejects malformed encryption keys', () => {
    expect(
      parseConfig({ ...base, NOTIFICATION_OFFLINE_GRACE_SECONDS: '120' })
        .NOTIFICATION_OFFLINE_GRACE_SECONDS,
    ).toBe(120);
    expect(() =>
      parseConfig({
        ...base,
        NOTIFICATION_ENCRYPTION_KEY: 'not-a-key',
        NOTIFICATION_FINGERPRINT_KEY: 'not-a-key',
      }),
    ).toThrow('Must be a 32-byte base64url value');
  });
});
