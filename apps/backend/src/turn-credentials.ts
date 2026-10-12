import { createHmac, randomUUID } from 'node:crypto';

interface TurnCredential {
  credential: string;
  expiresAt: Date;
  username: string;
}

export function createTurnCredential(
  sharedSecret: string,
  lifetimeSeconds: number,
  now = new Date(),
  nonce: string = randomUUID(),
): TurnCredential {
  const expiresAt = new Date(now.getTime() + lifetimeSeconds * 1_000);
  const username = `${Math.floor(expiresAt.getTime() / 1_000)}:${nonce}`;
  const credential = createHmac('sha1', sharedSecret)
    .update(username)
    .digest('base64');
  return { credential, expiresAt, username };
}
