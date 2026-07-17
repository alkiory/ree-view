/**
 * Healthcheck ligero para el HEALTHCHECK de Docker. Lanza una query
 * GraphQL barata (`{__typename}`) y exit 0/1 según la respuesta.
 *
 * NOTA: este archivo NO se compila (fuera de `src/`), se copia al
 * contenedor y Docker lo invoca directamente (CommonJS, no ESM).
 */
(async () => {
  try {
    const response = await fetch('http://localhost:3000/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{__typename}' }),
      signal: AbortSignal.timeout(5_000),
    });
    process.exit(response.ok ? 0 : 1);
  } catch {
    process.exit(1);
  }
})();
