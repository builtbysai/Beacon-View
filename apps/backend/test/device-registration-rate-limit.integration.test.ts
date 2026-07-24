import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { hashSecret } from '../src/security.js';
import {
  DEVICE_REGISTRATION_RATE_LIMITED,
  PostgresStore,
} from '../src/store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const store = databaseUrl ? new PostgresStore(databaseUrl) : null;
const config: AppConfig | null = databaseUrl
  ? {
      DATABASE_URL: databaseUrl,
      HOST: '127.0.0.1',
      LOG_LEVEL: 'silent',
      NODE_ENV: 'test',
      PORT: 3000,
      SESSION_COOKIE_NAME: 'beacon_session',
      WEB_ORIGIN: 'http://127.0.0.1:5173',
    }
  : null;
const app = store && config ? buildApp(config, store) : null;

describe.skipIf(!app || !store)(
  'device-registration database rate limit',
  () => {
    beforeEach(async () => {
      await store!.pool.query(
        'TRUNCATE audit_events, pairing_codes, device_credentials, cameras, browser_sessions, households, users CASCADE',
      );
    });

    afterAll(async () => {
      await app?.close();
    });

    it('allows ten registrations, returns generic 429 for the eleventh, and preserves ordinary failures', async () => {
      const owner = await store!.createAccount(
        'owner@example.com',
        'irrelevant-test-hash',
        '127.0.0.1',
      );
      const now = new Date();

      for (let index = 0; index < 9; index += 1) {
        const code = `ALLOWED${index}X`;
        await store!.createPairingCode(
          owner.householdId,
          hashSecret(code),
          new Date(now.getTime() + 60_000),
        );
        const result = await store!.redeemPairingCode({
          codeHash: hashSecret(code),
          credentialHash: hashSecret(`credential-${index}`),
          installationId: randomUUID(),
          ipAddress: '127.0.0.1',
          name: `Camera ${index}`,
          now,
        });
        expect(result).not.toBeNull();
        expect(result).not.toBe(DEVICE_REGISTRATION_RATE_LIMITED);
      }

      const tenthCode = 'TENTHCODEX';
      await store!.createPairingCode(
        owner.householdId,
        hashSecret(tenthCode),
        new Date(now.getTime() + 60_000),
      );
      const tenth = await app!.inject({
        method: 'POST',
        payload: {
          installationId: randomUUID(),
          name: 'Tenth Camera',
          pairingCode: tenthCode,
        },
        url: '/api/devices/register',
      });
      expect(tenth.statusCode).toBe(201);

      const exhaustedCode = 'LIMITEDXXX';
      await store!.createPairingCode(
        owner.householdId,
        hashSecret(exhaustedCode),
        new Date(now.getTime() + 60_000),
      );
      const exhausted = await app!.inject({
        method: 'POST',
        payload: {
          installationId: randomUUID(),
          name: 'Blocked Camera',
          pairingCode: exhaustedCode,
        },
        url: '/api/devices/register',
      });
      expect(exhausted.statusCode).toBe(429);
      expect(exhausted.json()).toEqual({ error: 'Too many requests' });
      expect(exhausted.body).not.toMatch(
        /account|household|camera|pairing|credential|code/i,
      );

      const invalid = await app!.inject({
        method: 'POST',
        payload: {
          installationId: randomUUID(),
          name: 'Invalid Camera',
          pairingCode: 'INVALIDXXX',
        },
        url: '/api/devices/register',
      });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json()).toEqual({ error: 'Unable to pair device' });
    });
  },
);
