import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    exclude: ['node_modules', 'dist', 'test/**'],
    environment: 'node',
    globals: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/main.ts', 'src/**/*.module.ts'],
    },
  },
});
