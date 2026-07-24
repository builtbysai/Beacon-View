import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function generatePairingCode(): string {
  const output: string[] = [];
  const unbiasedLimit =
    Math.floor(256 / PAIRING_ALPHABET.length) * PAIRING_ALPHABET.length;
  while (output.length < 10) {
    for (const value of randomBytes(16)) {
      if (value < unbiasedLimit) {
        output.push(PAIRING_ALPHABET[value % PAIRING_ALPHABET.length]!);
      }
      if (output.length === 10) break;
    }
  }
  return output.join('');
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password, {
    algorithm: 2,
    memoryCost: 19_456,
    parallelism: 1,
    timeCost: 2,
  });
}

export async function verifyPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  return verify(passwordHash, password);
}

export function secretsEqual(first: string, second: string): boolean {
  const firstBuffer = Buffer.from(first);
  const secondBuffer = Buffer.from(second);
  return (
    firstBuffer.length === secondBuffer.length &&
    timingSafeEqual(firstBuffer, secondBuffer)
  );
}
