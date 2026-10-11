import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  deleteDriveRecordingFile,
  driveProviderEmail,
  GoogleDriveRequestError,
  initiateDriveRecordingUpload,
  revokeDriveRefreshToken,
  verifyDriveAppDataAccess,
  verifyDriveRecordingFile,
  verifyDriveRecordingAccess,
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

  it('verifies recording scope without listing unrelated Drive files', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ files: [] })));
    vi.stubGlobal('fetch', fetch);

    await expect(
      verifyDriveRecordingAccess('recording-token'),
    ).resolves.toBeUndefined();

    const [url] = fetch.mock.calls[0]!;
    if (typeof url !== 'string') throw new Error('Expected a string URL');
    expect(url).toContain('appProperties');
    expect(url).toContain('beacon');
  });

  it('creates a bounded resumable session without returning an access token', async () => {
    const location =
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=safe-id';
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(null, { headers: { location } }));
    vi.stubGlobal('fetch', fetch);

    await expect(
      initiateDriveRecordingUpload({
        accessToken: 'private-access-token',
        byteSize: 1_024,
        mimeType: 'application/octet-stream',
        origin: 'https://beacon.example',
        recordingId: '8aedbca1-6d5a-47b6-8c31-d20da64eb670',
      }),
    ).resolves.toBe(location);

    const [url, options] = fetch.mock.calls[0]!;
    const requestUrl =
      typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    expect(requestUrl).not.toContain('private-access-token');
    expect(new Headers(options?.headers).get('authorization')).toBe(
      'Bearer private-access-token',
    );
    expect(new Headers(options?.headers).get('x-upload-content-length')).toBe(
      '1024',
    );
    expect(new Headers(options?.headers).get('origin')).toBe(
      'https://beacon.example',
    );
    if (typeof options?.body !== 'string')
      throw new Error('Expected a string request body');
    expect(options.body).not.toContain('private-access-token');
  });

  it('names a thumbnail upload apart from its clip (V53)', async () => {
    const location =
      'https://www.googleapis.com/upload/drive/v3/files?upload_id=x';
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(null, { headers: { location } }));
    vi.stubGlobal('fetch', fetch);
    await initiateDriveRecordingUpload({
      accessToken: 'token',
      byteSize: 10,
      mimeType: 'application/octet-stream',
      part: 'thumbnail',
      recordingId: '8aedbca1-6d5a-47b6-8c31-d20da64eb670',
    });
    const body = JSON.parse(fetch.mock.calls[0]![1]?.body as string) as {
      appProperties: Record<string, string>;
      name: string;
    };
    expect(body.name).toBe(
      'Beacon-thumbnail-8aedbca1-6d5a-47b6-8c31-d20da64eb670.beacon',
    );
    expect(body.appProperties).toMatchObject({
      beacon: 'recording',
      part: 'thumbnail',
    });
  });

  it('accepts only the Drive file created for the expected recording', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            appProperties: {
              beacon: 'recording',
              recordingId: '8aedbca1-6d5a-47b6-8c31-d20da64eb670',
            },
            id: 'drive-file-id',
            mimeType: 'application/octet-stream',
            size: '1024',
            trashed: false,
          }),
        ),
      ),
    );

    await expect(
      verifyDriveRecordingFile({
        accessToken: 'recording-token',
        byteSize: 1_024,
        mimeType: 'application/octet-stream',
        providerFileId: 'drive-file-id',
        recordingId: '8aedbca1-6d5a-47b6-8c31-d20da64eb670',
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects a Drive file whose size or recording identity differs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            appProperties: {
              beacon: 'recording',
              recordingId: 'different-recording',
            },
            id: 'drive-file-id',
            mimeType: 'application/octet-stream',
            size: '12',
            trashed: false,
          }),
        ),
      ),
    );

    await expect(
      verifyDriveRecordingFile({
        accessToken: 'recording-token',
        byteSize: 1_024,
        mimeType: 'application/octet-stream',
        providerFileId: 'drive-file-id',
        recordingId: '8aedbca1-6d5a-47b6-8c31-d20da64eb670',
      }),
    ).rejects.toThrow('metadata did not match');
  });

  it('deletes only the selected Drive recording file', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);

    await expect(
      deleteDriveRecordingFile('recording-token', 'provider/file id'),
    ).resolves.toBeUndefined();

    const [url, options] = fetch.mock.calls[0]!;
    expect(url).toBe(
      'https://www.googleapis.com/drive/v3/files/provider%2Ffile%20id',
    );
    expect(options?.method).toBe('DELETE');
    expect(new Headers(options?.headers).get('authorization')).toBe(
      'Bearer recording-token',
    );
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
