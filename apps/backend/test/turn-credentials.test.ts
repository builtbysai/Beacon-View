import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { createTurnCredential } from '../src/turn-credentials.js';

describe('ephemeral TURN credentials', () => {
  it('creates a deterministic Coturn REST credential with a ten-minute expiry', () => {
    const secret = 'test-shared-secret-with-at-least-32-bytes';
    const credential = createTurnCredential(
      secret,
      600,
      new Date('2026-07-24T12:00:00.000Z'),
      'test-nonce',
    );

    expect(credential.username).toBe('1784895000:test-nonce');
    expect(credential.expiresAt.toISOString()).toBe('2026-07-24T12:10:00.000Z');
    expect(credential.credential).toBe(
      createHmac('sha1', secret).update(credential.username).digest('base64'),
    );
    expect(JSON.stringify(credential)).not.toContain(secret);
  });
});
