// Healthcheck ligero para el HEALTHCHECK de Docker.
// Usa fetch nativo de Node 18+; lanza una query GraphQL barata ({__typename})
// y exit 0/1 según el código de respuesta.
//
// Importante: este archivo NO se compila (nest build lo excluye porque está
// fuera de src/), se copia al contenedor tal cual y Docker lo invoca vía shell.
// IMPORTANTE: este archivo se ejecuta con `node healthcheck.js` desde
// el Dockerfile (CommonJS por defecto, sin flag --experimental-vm-modules).
// Top-level await NO funciona en CJS, así que todo va dentro de una
// IIFE async. Si en el futuro el backend pasa a ESM (package.json
// "type":"module"), se puede convertir a top-level await.
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
