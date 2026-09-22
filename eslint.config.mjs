import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/build/**',
      '**/node_modules/**',
      '**/.beacon-dev/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ['**/*.ts', '**/*.tsx'],
  })),
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['apps/backend/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/web-viewer/**/*.ts', 'apps/web-viewer/**/*.tsx'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    files: ['**/*.config.ts', '**/*.config.mjs', 'eslint.config.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['scripts/**/*.mjs', 'apps/backend/**/*.mjs', 'tools/**/*.js'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/web-viewer/public/sw.js'],
    languageOptions: { globals: globals.serviceworker },
  },
);
