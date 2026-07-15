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
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
