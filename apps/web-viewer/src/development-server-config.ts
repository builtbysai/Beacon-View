export interface DevelopmentServerEnvironment {
  VITE_ALLOWED_HOST?: string;
  VITE_BACKEND_PROXY_TARGET?: string;
  VITE_DEV_HOST?: string;
  VITE_DEV_PORT?: string;
  VITE_HMR_HOST?: string;
  VITE_HTTPS_PORT?: string;
}

export function createDevelopmentServerConfig(
  environment: DevelopmentServerEnvironment,
) {
  const port = parsePort(environment.VITE_DEV_PORT, 5173, 'VITE_DEV_PORT');
  const httpsPort = parsePort(
    environment.VITE_HTTPS_PORT,
    8443,
    'VITE_HTTPS_PORT',
  );
  const allowedHosts = ['localhost', '127.0.0.1'];
  if (environment.VITE_ALLOWED_HOST) {
    allowedHosts.push(environment.VITE_ALLOWED_HOST);
  }
  return {
    allowedHosts,
    host: environment.VITE_DEV_HOST || '127.0.0.1',
    ...(environment.VITE_HMR_HOST
      ? {
          hmr: {
            clientPort: httpsPort,
            host: environment.VITE_HMR_HOST,
            protocol: 'wss' as const,
          },
        }
      : {}),
    port,
    proxy: {
      '/api': {
        target:
          environment.VITE_BACKEND_PROXY_TARGET || 'http://127.0.0.1:3000',
        ws: true,
      },
    },
    strictPort: true,
  };
}

function parsePort(
  value: string | undefined,
  fallback: number,
  field: string,
): number {
  if (value === undefined) return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${field} must be an integer from 1 to 65535`);
  }
  return port;
}
