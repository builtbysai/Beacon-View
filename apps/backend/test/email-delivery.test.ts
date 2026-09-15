import { afterEach, describe, expect, it, vi } from 'vitest';

import { deliverHouseholdInvitation, ResendDeliveryError } from '../src/contact.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const config = {
  RESEND_API_KEY: 're_test_key',
  RESEND_FROM: 'Beacon Security <security@example.com>',
  WEB_ORIGIN: 'https://beacon.example.com',
};

describe('household invitation email delivery', () => {
  it('sends a code without including household or camera metadata', async () => {
    const fetchMock = vi.fn<
      (input: string | URL, init?: RequestInit) => Promise<Response>
    >(() => Promise.resolve(new Response(null, { status: 202 })));
    vi.stubGlobal('fetch', fetchMock);

    await deliverHouseholdInvitation(config, {
      expiresAt: new Date('2026-09-14T12:00:00.000Z'),
      role: 'guest',
      token: 'one-time-invitation-code',
      to: 'guest@example.com',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({ method: 'POST' }),
    );
    const request = fetchMock.mock.calls[0]![1]!;
    if (!request || typeof request.body !== 'string')
      throw new Error('Expected a serialized email request');
    const body = JSON.parse(request.body) as { text: string };
    expect(body.text).toContain('one-time-invitation-code');
    expect(body.text).toContain('https://beacon.example.com');
    expect(body.text).not.toContain('camera');
    expect(body.text).not.toContain('household name');
  });

  it('surfaces provider failures to the invitation route, with Resend\'s own reason for diagnosis', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              message: 'Invalid `to` field.',
              name: 'validation_error',
            }),
            { status: 422 },
          ),
        ),
      ),
    );

    const attempt = deliverHouseholdInvitation(config, {
      expiresAt: new Date('2026-09-14T12:00:00.000Z'),
      role: 'viewer',
      token: 'one-time-invitation-code',
      to: 'viewer@example.com',
    });

    await expect(attempt).rejects.toBeInstanceOf(ResendDeliveryError);
    await expect(attempt).rejects.toMatchObject({
      reason: 'validation_error',
      status: 422,
    });
  });
});
