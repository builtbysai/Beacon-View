import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  driveProviderEmail,
  GoogleDriveRequestError,
  revokeDriveRefreshToken,
  verifyDriveAppDataAccess,
} from '../src/google-drive-client.js';

afterEach(() => vi.unstubAllGlobals());

describe('Google Drive OAuth client', () => {
  it('proves access against the private app-data space', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ files: [] })));
    vi.stubGlobal('fetch', fetch);

    await expect(
      verifyDriveAppDataAccess('access-token'),
    ).resolves.toBeUndefined();

    const [url, options] = fetch.mock.calls[0]!;
    if (typeof url !== 'string') throw new Error('Expected a string URL');
    expect(url).toContain('/drive/v3/files?');
    expect(url).toContain('spaces=appDataFolder');
    expect(new Headers(options?.headers).get('authorization')).toBe(
      'Bearer access-token',
    );
  });

  it('does not accept provider identity when Drive rejects the token', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(new Response(null, { status: 403 })),
    );

    await expect(driveProviderEmail('denied-token')).rejects.toMatchObject({
      operation: 'provider_identity',
      status: 403,
    } satisfies Partial<GoogleDriveRequestError>);
  });

  it('revokes a refresh token without placing it in the URL', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetch);

    await expect(revokeDriveRefreshToken('private-token')).resolves.toBe(true);

    const [url, options] = fetch.mock.calls[0]!;
    expect(url).toBe('https://oauth2.googleapis.com/revoke');
    expect(options?.body).toBeInstanceOf(URLSearchParams);
    expect((options?.body as URLSearchParams).toString()).toBe(
      'token=private-token',
    );
  });

  it('reports provider rejection without exposing response details', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(new Response(null, { status: 400 })),
    );

    await expect(revokeDriveRefreshToken('expired-token')).resolves.toBe(false);
  });
});
