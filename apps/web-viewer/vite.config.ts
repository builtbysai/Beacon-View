import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

import { createDevelopmentServerConfig } from './src/development-server-config';

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: createDevelopmentServerConfig(environment),
    test: {
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
    },
  };
});
