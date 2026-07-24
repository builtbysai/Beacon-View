import { fileURLToPath } from 'node:url';
import { config as loadEnvironment } from 'dotenv';

import { buildApp } from './app.js';
import { parseConfig } from './config.js';

loadEnvironment({
  override: false,
  path: fileURLToPath(new URL('../.env', import.meta.url)),
});

const config = parseConfig(process.env);
const app = buildApp(config);
let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  app.log.info({ signal }, 'Shutdown requested');
  await app.close();
  process.exitCode = 0;
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown(signal).catch((error: unknown) => {
      app.log.error({ err: error }, 'Graceful shutdown failed');
      process.exitCode = 1;
    });
  });
}

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.fatal({ err: error }, 'Backend startup failed');
  process.exitCode = 1;
  await app.close();
}
