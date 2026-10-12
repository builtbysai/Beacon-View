import { createPublicKey, verify } from 'node:crypto';

/**
 * Signed update feeds (ADR 0110). The installer is already checked against the
 * SHA-512 in latest*.yml, but that file is served from the same server as the
 * installer, so whoever could replace one could replace the other. The owner
 * signs each feed file with an Ed25519 key that never leaves their computer; the
 * app carries the matching public key and acts only on a feed that verifies.
 */
const UPDATE_SIGNING_PUBLIC_KEY =
  'tehdjGrvyI3nTJmZat+4BXt7FkOuY+xpnzq3yu389vQ=';

// SubjectPublicKeyInfo prefix for a raw 32-byte Ed25519 public key.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export function verifyFeedSignature(
  feed: Buffer,
  signatureBase64: string,
  publicKeyBase64: string = UPDATE_SIGNING_PUBLIC_KEY,
): boolean {
  try {
    const raw = Buffer.from(publicKeyBase64, 'base64');
    if (raw.length !== 32) return false;
    const key = createPublicKey({
      format: 'der',
      key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
      type: 'spki',
    });
    const signature = Buffer.from(signatureBase64.trim(), 'base64');
    if (signature.length !== 64) return false;
    return verify(null, feed, key, signature);
  } catch {
    return false;
  }
}

/** The feed file for a platform, as electron-builder names them. */
export function feedFileName(platform: NodeJS.Platform): string {
  if (platform === 'win32') return 'latest.yml';
  if (platform === 'darwin') return 'latest-mac.yml';
  return 'latest-linux.yml';
}

/**
 * True when what electron-updater read (its own request, made separately) is
 * exactly what was signed: the same version, and every installer checksum it
 * reported appears in the signed feed. electron-updater then checks the
 * downloaded installer against those checksums.
 */
export function updateMatchesSignedFeed(
  update: { version: string; files: { sha512: string }[] },
  signedFeed: string,
): boolean {
  if (update.files.length === 0) return false;
  const versionLine = signedFeed
    .split(/\r?\n/u)
    .find((line) => /^version:/u.test(line));
  const signedVersion = versionLine?.slice('version:'.length).trim();
  if (signedVersion?.replace(/^['"]|['"]$/gu, '') !== update.version)
    return false;
  return update.files.every((file) => signedFeed.includes(file.sha512));
}
