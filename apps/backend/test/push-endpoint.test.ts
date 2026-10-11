import { describe, expect, it } from 'vitest';

import { isPushServiceEndpoint } from '../src/push-endpoint.js';

describe('Web Push endpoint allow-list (V8)', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/abc',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
  ])('accepts a browser push service: %s', (endpoint) => {
    expect(isPushServiceEndpoint(endpoint)).toBe(true);
  });

  it.each([
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://169.254.169.254/latest/meta-data/',
    'https://localhost:3000/internal',
    'https://postgres:5432/',
    'https://evil.example/fcm.googleapis.com',
    'https://fcm.googleapis.com.evil.example/x',
    'https://notfcm.googleapis.com.example/x',
    'https://user:pass@fcm.googleapis.com/x',
    'https://fcm.googleapis.com:8443/x',
    'not a url',
  ])('rejects %s', (endpoint) => {
    expect(isPushServiceEndpoint(endpoint)).toBe(false);
  });
});
