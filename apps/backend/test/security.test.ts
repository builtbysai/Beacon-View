import { describe, expect, it } from 'vitest';

import { isCameraOnline } from '../src/app.js';
import { RateLimiter } from '../src/rate-limit.js';
import {
  generatePairingCode,
  generateToken,
  hashPassword,
  hashSecret,
  normalizeEmail,
  verifyPassword,
} from '../src/security.js';

describe('security primitives', () => {
  it('normalizes email addresses before lookup', () => {
    expect(normalizeEmail(' Owner@Example.COM ')).toBe('owner@example.com');
  });

  it('hashes passwords with Argon2id and verifies without retaining plaintext', async () => {
    const encoded = await hashPassword('correct horse battery staple');
    expect(encoded).toContain('argon2id');
    expect(encoded).not.toContain('correct horse battery staple');
    await expect(
      verifyPassword(encoded, 'correct horse battery staple'),
    ).resolves.toBe(true);
    await expect(verifyPassword(encoded, 'incorrect password')).resolves.toBe(
      false,
    );
  });

  it('generates high-entropy opaque tokens and unambiguous pairing codes', () => {
    const token = generateToken();
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(generatePairingCode()).toMatch(
      /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/,
    );
    expect(hashSecret(token)).not.toBe(token);
  });
});

describe('rate limits and camera presence', () => {
  it('rejects attempts after the configured limit within its window', () => {
    const limiter = new RateLimiter();
    expect(limiter.take('login', 2, 1_000, 1_000)).toBe(true);
    expect(limiter.take('login', 2, 1_000, 1_001)).toBe(true);
    expect(limiter.take('login', 2, 1_000, 1_002)).toBe(false);
    expect(limiter.take('login', 2, 1_000, 2_002)).toBe(true);
  });

  it('treats exactly 90 seconds as online and older heartbeats as offline', () => {
    const now = new Date('2026-07-23T12:00:00.000Z');
    expect(isCameraOnline(new Date(now.getTime() - 90_000), now)).toBe(true);
    expect(isCameraOnline(new Date(now.getTime() - 90_001), now)).toBe(false);
    expect(isCameraOnline(null, now)).toBe(false);
  });
});
