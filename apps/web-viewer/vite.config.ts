import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

import { createDevelopmentServerConfig } from './src/development-server-config';

/** Writes /version.json beside the build: the entry script this release loads. A page that is already open
 * compares it with its own entry script to learn that a newer version was deployed (ADR 0118). */
function versionFile(): Plugin {
  return {
    apply: 'build',
    generateBundle(_options, bundle) {
      const entry = Object.values(bundle).find(
        (chunk) => chunk.type === 'chunk' && chunk.isEntry,
      );
      if (!entry) return;
      this.emitFile({
        fileName: 'version.json',
        source: `${JSON.stringify({ builtAt: new Date().toISOString(), entry: entry.fileName })}\n`,
        type: 'asset',
      });
    },
    name: 'beacon-version-file',
  };
}

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), versionFile()],
    server: createDevelopmentServerConfig(environment),
    test: {
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
    },
  };
});
