import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: {
      host: environment.VITE_DEV_HOST || '127.0.0.1',
      port: 5173,
      proxy: {
        '/api': { target: 'http://127.0.0.1:3000', ws: true },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
    },
  };
});
