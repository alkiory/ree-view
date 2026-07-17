/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * URL completa del endpoint GraphQL del backend (incluye `/graphql`).
   * Ejemplos:
   *  - Dev local:    http://localhost:3000/graphql
   *  - Docker:       http://backend:3000/graphql
   *  - Producción:   https://api.tu-dominio.com/graphql
   */
  readonly VITE_API_URL: string;

  /**
   * Phase 2 §3.39 — opt-in flag para el mock fallback de live demand.
   *
   * Default: `undefined` / `false` en cualquier build (prod + dev).
   * Cuando `=== 'true'`, `App.tsx` renderiza `<MockLiveDemandCard />`
   * en lugar de `<LiveDemandCard />` — útil para dev offline / sandbox
   * sin acceso a apiDatos.ree.es.
   *
   * NUNCA activar en producción: los datos sintéticos se confundirían
   * con datos reales y violarían la promesa §3.37 de "100% datos
   * reales por defecto".
   *
   * Verificado en build-time vía Vite static-replace (no runtime cost).
   */
  readonly VITE_ENABLE_MOCK_FALLBACK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
