import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  feedFileName,
  updateMatchesSignedFeed,
  verifyFeedSignature,
} from '../src/update-signature.js';

function keys() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  return { privateKey, publicKey: raw.toString('base64') };
}

const feed = `version: 0.4.1
files:
  - url: Beacon-Setup-0.4.1.exe
    sha512: AAAAsha512ofinstallerAAAA==
    size: 1234
path: Beacon-Setup-0.4.1.exe
sha512: AAAAsha512ofinstallerAAAA==
releaseDate: '2026-10-10T00:00:00.000Z'
`;

describe('signed update feed (V2)', () => {
  it('accepts the owner signature and nothing else', () => {
    const owner = keys();
    const other = keys();
    const signature = sign(null, Buffer.from(feed), owner.privateKey).toString(
      'base64',
    );
    expect(
      verifyFeedSignature(Buffer.from(feed), signature, owner.publicKey),
    ).toBe(true);
    // A different key, an edited feed, junk, and a wrong-length signature all fail.
    expect(
      verifyFeedSignature(Buffer.from(feed), signature, other.publicKey),
    ).toBe(false);
    expect(
      verifyFeedSignature(
        Buffer.from(feed.replace('0.4.1', '9.9.9')),
        signature,
        owner.publicKey,
      ),
    ).toBe(false);
    expect(
      verifyFeedSignature(Buffer.from(feed), 'not-base64!', owner.publicKey),
    ).toBe(false);
    expect(
      verifyFeedSignature(Buffer.from(feed), 'AAAA', owner.publicKey),
    ).toBe(false);
    expect(verifyFeedSignature(Buffer.from(feed), signature, 'short')).toBe(
      false,
    );
  });

  it('accepts a trailing newline in the stored signature file', () => {
    const owner = keys();
    const signature = sign(null, Buffer.from(feed), owner.privateKey).toString(
      'base64',
    );
    expect(
      verifyFeedSignature(Buffer.from(feed), `${signature}\n`, owner.publicKey),
    ).toBe(true);
  });

  it('only trusts an update that matches the signed feed', () => {
    const good = {
      files: [{ sha512: 'AAAAsha512ofinstallerAAAA==' }],
      version: '0.4.1',
    };
    expect(updateMatchesSignedFeed(good, feed)).toBe(true);
    // A planted feed served to electron-updater with another installer or version.
    expect(
      updateMatchesSignedFeed(
        { ...good, files: [{ sha512: 'EVILsha512EVIL==' }] },
        feed,
      ),
    ).toBe(false);
    expect(updateMatchesSignedFeed({ ...good, version: '0.4.2' }, feed)).toBe(
      false,
    );
    expect(updateMatchesSignedFeed({ ...good, files: [] }, feed)).toBe(false);
  });

  it('names each platform’s feed file', () => {
    expect(feedFileName('win32')).toBe('latest.yml');
    expect(feedFileName('darwin')).toBe('latest-mac.yml');
    expect(feedFileName('linux')).toBe('latest-linux.yml');
  });
});
