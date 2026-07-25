import { describe, expect, it } from 'vitest';

import { createDevelopmentServerConfig } from './development-server-config';

describe('development server configuration', () => {
  it('keeps localhost defaults and uses a strict port', () => {
    const config = createDevelopmentServerConfig({});
    expect(config).toMatchObject({
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
    });
    expect(config.hmr).toBeUndefined();
  });

  it('constructs LAN-safe host, HMR, and proxy configuration', () => {
    const config = createDevelopmentServerConfig({
      VITE_ALLOWED_HOST: '192.0.2.10',
      VITE_BACKEND_PROXY_TARGET: 'http://127.0.0.1:3000',
      VITE_DEV_HOST: '0.0.0.0',
      VITE_DEV_PORT: '5173',
      VITE_HMR_HOST: '192.0.2.10',
      VITE_HTTPS_PORT: '8443',
    });
    expect(config).toMatchObject({
      allowedHosts: ['localhost', '127.0.0.1', '192.0.2.10'],
      host: '0.0.0.0',
      hmr: {
        clientPort: 8443,
        host: '192.0.2.10',
        protocol: 'wss',
      },
      port: 5173,
      strictPort: true,
    });
  });

  it('rejects invalid configured ports', () => {
    expect(() =>
      createDevelopmentServerConfig({ VITE_DEV_PORT: '5174.5' }),
    ).toThrow('VITE_DEV_PORT');
  });
});
