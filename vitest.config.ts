import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [
      'tests/browser/**',
      'tests/maskIntegrity.test.ts',
      'tests/sceneTransitions.test.ts',
      'tests/localAi.test.ts',
      '.artifacts/**',
      'node_modules/**',
    ],
  },
});
