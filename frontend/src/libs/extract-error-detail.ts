/**
 * Extrae el detalle accionable de un ApolloError para mostrar en la UI.
 *
 * El ApolloError que entrega Apollo Client al frontend cuando el backend
 * lanza un `BadRequestException(messages)` viene con esta forma:
 *
 *   error.message                === "Bad Request Exception"  (opaco)
 *   error.graphQLErrors[0].message                === "Bad Request Exception"
 *   error.graphQLErrors[0].extensions.originalError.message
 *                                  === ["endDate must be at most 365…", …]  ← LO QUE QUIERE VER EL USUARIO
 *
 * Cadena de prioridad (primera coincidencia gana; la numeración del JSDoc
 * 1:5 está alineada con el orden literal de las ramas `if`):
 *   1. `extensions.originalError.message` — el motivo real. Puede ser
 *      `string` (caso `throw new BadRequestException("x")`) o `string[]`
 *      (caso `ValidationPipe` con `stopAtFirstError: false` y/o validación
 *      manual del resolver que acumula `flatMap(Object.values(constraints))`).
 *      Sub-rama 1a: array → primer elemento. Sub-rama 1b: string → tal cual.
 *   2. `graphQLErrors[0].message` — útil cuando el error es de sintaxis
 *      GraphQL (NO envuelto en BadRequestException, p.ej. "Expected Name, found '}'").
 *   3. **Dead-backend branch** — `networkError` set + `graphQLErrors`
 *      vacío + `error.message === 'Network Error'` (canonical Apollo v3
 *      fetch-failure string). NO disparamos para ServerError (5xx con
 *      mensaje 'Response not successful: Received status code 502')
 *      porque ESO significa que el backend SÍ está corriendo y devolvió
 *      error — la rama 4 con `error.message` surfacea la causa real.
 *   4. `error.message` — fallback genérico. Cubre ServerError (502 upstream,
 *      timeout, etc.) donde el operador SÍ ve un detalle accionable.
 *   5. `'Error desconocido'` — último recurso, nunca debería aparecer en vivo.
 *
 * Por qué el ``[boot] REE_API_URL no configurado`` del backend no llega
 * aquí: cuando la guard del constructor dispara, el proceso muere ANTES
 * de hacer `app.listen`, así que el puerto nunca se bindea. Apollo intenta
 * fetch, recibe ECONNREFUSED, y produce exactamente el shape de la rama 3.
 * El mensaje útil vive en `stderr` del backend (developer-visible); la UI
 * sólo puede orientar al operador a revisar dicho log.
 *
 * Referencia: investigación bug A + bug B — propuesta §1.2 + §2.3.
 */
export type ApolloLikeError = {
  message?: string;
  // `ReadonlyArray` para coincidir con `ApolloError.graphQLErrors:
  // readonly GraphQLFormattedError[]` (Apollo v3 native). Sin readonly,
  // TypeScript rechaza pasar `ApolloError` directo a `extractErrorDetail`
  // (los consumidores del hook LiveDemand usan `ApolloError as`).
  graphQLErrors?: ReadonlyArray<{
    message?: string;
    extensions?: {
      originalError?: {
        message?: string | string[];
      };
    };
  }>;
  // Apollo expone `networkError: Error | null`. Lo tipamos solo con
  // `message?` porque sólo necesitamos discriminar presencia, no tipar
  // profundamente (cualquier NetworkError-like sirve para clasificar).
  networkError?: { message?: string } | null;
};

export function extractErrorDetail(
  error: ApolloLikeError | null | undefined,
): string {
  const gqe = error?.graphQLErrors?.[0];
  const original = gqe?.extensions?.originalError?.message;

  // 1a — array
  if (
    Array.isArray(original) &&
    original.length > 0 &&
    typeof original[0] === "string"
  ) {
    return original[0];
  }
  // 1b — string
  if (typeof original === "string" && original.length > 0) {
    return original;
  }
  // 2 — GraphQL syntax error / unwrapped message
  if (gqe?.message) {
    return gqe.message;
  }
  // 3 — Dead backend (Apollo v3 fetch failure). Cubre DOS cadenas de
  // mensaje que ApolloClient v3 pone en `error.message` cuando FETCH no
  // consigue respuesta:
  //   - 'Network Error'     → típico en Node / older Chromium para
  //                           ECONNREFUSED, DNS failure, TLS error.
  //   - 'Failed to fetch'   → Chrome 88+ para CORS-rejected preflight,
  //                           request bloqueado por el browser.
  // NO match para ServerError (5xx) porque su discriminator es el
  // patrón "Response not successful: Received status code N" — no
  // empieza con ninguna de las dos cadenas anteriores. Por eso el OR es
  // seguro: nunca dispara accidentalmente para 502 upstream REE.
  if (
    (!error?.graphQLErrors || error.graphQLErrors.length === 0) &&
    error?.networkError &&
    (error?.message === "Network Error" || error?.message === "Failed to fetch")
  ) {
    return "No se pudo conectar con el servidor backend. Verifica que el proceso esté en ejecución (los detalles del fallo aparecen en la consola del backend).";
  }
  // 4 — fallback genérico (incluye ServerError / timeout)
  if (error?.message) {
    return error.message;
  }
  // 5 — último recurso
  return "Error desconocido";
}
