import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
//
// Proxy `/graphql` (mismo path que usa `frontend/src/libs/apollo-client.ts`
// cuando `VITE_API_URL` no está seteado) hacia el backend NestJS durante
// `pnpm dev`. Esto evita:
//
//   • CORS — el browser ve solo /:5173 (mismo origen).
//   • DNS `backend` — no se resuelve desde el browser; la resolución
//     la hace Vite internamente hacia el BACKEND_URL configurado.
//
// Resolución del target (en orden de precedencia):
//   1. `BACKEND_URL`    → e.g. `BACKEND_URL=http://localhost:3001 pnpm dev`
//                          (devs locales con el backend `pnpm dev PORT=3001`)
//   2. `VITE_API_URL`   → si el dev quiere compatibilidad con el bundle
//                          docker, puede exportar `VITE_API_URL=http://...`
//                          y Vite lo apuntará allí. Útil para reproducir
//                          bugs de staging sin abrir firewall.
//   3. default          → `http://localhost:3000` (NEST_PORT default).
//
// En Docker (`pnpm build` + nginx), este proxy NO se ejecuta: nginx
// resuelve la ruta directamente contra el hostname `backend`. Por eso
// el default solo aplica a `pnpm dev`.
const proxyTarget = (() => {
  const raw = process.env.BACKEND_URL || process.env.VITE_API_URL || 'http://localhost:3000'
  return raw.replace(/\/+$/, '') // strip trailing slashes
})()

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/graphql': {
        target: proxyTarget,
        changeOrigin: true,
        // `ws: true` para `graphql-ws` cuando se añada subscriptions
        // (hoy @nestjs/apollo@12 aún no las soporta por default pero
        // dejamos abierto el path para WebSocket upgrades).
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
})
