import { defineConfig } from 'vitest/config';

/**
 * Vitest convive con Jest sin colisiones porque:
 *  - Vitest busca en `src/**\/*.spec.ts`
 *  - Jest tiene `rootDir: 'test/'` en package.json, así que ignora /src/
 *
 * Tests de Vitest se enfocan en lógica interna aislable (servicios con
 * HttpService, transformaciones puras, etc.) donde el speed de
 * esbuild/tsx manda sobre la integración E2E que ya cubre Jest.
 */
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
