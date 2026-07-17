import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'

// Proxy `/graphql` hacia el backend NestJS durante `pnpm dev` (resuelve
// CORS y la resolución DNS `backend` que el browser no puede hacer).
// Target: `BACKEND_URL` > `VITE_API_URL` > `http://localhost:3000`.
const proxyTarget = (() => {
  const raw = process.env.BACKEND_URL || process.env.VITE_API_URL || 'http://localhost:3000'
  return raw.replace(/\/+$/, '')
})()

export default defineConfig({
  base: process.env.VITE_BASE_URL || '/',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/graphql': {
        target: proxyTarget,
        changeOrigin: true,
        ws: true,
        configure(proxy) {
          proxy.on('error', (err) => {
            // eslint-disable-next-line no-console
            console.error(
              `[vite-proxy] /graphql → ${proxyTarget} error: ${err.message}`,
            )
          })
        },
      },
    },
  },
  test: {
    include: ['src/**/*.spec.ts'],
    exclude: ['node_modules', 'dist'],
    environment: 'node',
    globals: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/main.tsx'],
    },
  },
})
