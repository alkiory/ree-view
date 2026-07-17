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
   * Opt-in flag para renderizar el mock fallback de live demand.
   *
   * Default: inactiva (cualquier valor distinto de `"true"`). Cuando
   * `=== "true"`, `App.tsx` renderiza `<MockLiveDemandCard />` en
   * lugar de `<LiveDemandCard />` — útil para dev offline / sandbox
   * sin acceso a apiDatos.ree.es.
   *
   * NUNCA activar en producción: los datos sintéticos se confundirían
   * con datos reales. Vite hace static-replace en build-time (no hay
   * coste runtime).
   */
  readonly VITE_ENABLE_MOCK_FALLBACK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
