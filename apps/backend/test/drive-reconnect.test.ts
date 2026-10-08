import type { OAuth2Client } from 'google-auth-library';
import { describe, expect, it } from 'vitest';

import {
  DriveReconnectRequiredError,
  isInvalidGrant,
  refreshDriveAccessToken,
} from '../src/google-drive-client.js';

function client(getAccessToken: () => Promise<{ token?: string | null }>) {
  return {
    getAccessToken,
    setCredentials: () => undefined,
  } as unknown as OAuth2Client;
}

describe('Drive token refresh', () => {
  it('recognizes Google invalid_grant responses', () => {
    expect(
      isInvalidGrant({ response: { data: { error: 'invalid_grant' } } }),
    ).toBe(true);
    expect(
      isInvalidGrant(new Error('invalid_grant: Token has been expired')),
    ).toBe(true);
    expect(isInvalidGrant(new Error('ETIMEDOUT'))).toBe(false);
    expect(
      isInvalidGrant({ response: { data: { error: 'server_error' } } }),
    ).toBe(false);
  });

  it('turns an expired or revoked token into a reconnect request', async () => {
    const expired = Object.assign(new Error('invalid_grant'), {
      response: { data: { error: 'invalid_grant' } },
    });
    await expect(
      refreshDriveAccessToken(
        client(() => Promise.reject(expired)),
        'dead',
      ),
    ).rejects.toBeInstanceOf(DriveReconnectRequiredError);
  });

  it('leaves transient failures alone so a blip never disconnects Drive', async () => {
    const network = new Error('socket hang up');
    await expect(
      refreshDriveAccessToken(
        client(() => Promise.reject(network)),
        'ok',
      ),
    ).rejects.toBe(network);
    await expect(
      refreshDriveAccessToken(
        client(() => Promise.resolve({ token: 'abc' })),
        'ok',
      ),
    ).resolves.toBe('abc');
  });
});
