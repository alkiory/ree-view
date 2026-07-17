/**
 * Extrae el detalle accionable de un ApolloError para mostrar en la UI.
 *
 * Cadena de prioridad (primera coincidencia gana):
 *   1. `extensions.originalError.message` — motivo real. Puede ser
 *      `string` o `string[]` (caso ValidationPipe con múltiples errors).
 *   2. `graphQLErrors[0].message` — útil para errores de sintaxis
 *      GraphQL no envueltos en BadRequestException.
 *   3. Backend caído: `networkError` set + `graphQLErrors` vacío +
 *      mensaje 'Network Error' o 'Failed to fetch' (Apollo v3).
 *   4. `error.message` — fallback genérico. Cubre ServerError 5xx.
 *   5. `'Error desconocido'` — último recurso.
 */
export type ApolloLikeError = {
  message?: string;
  graphQLErrors?: ReadonlyArray<{
    message?: string;
    extensions?: {
      originalError?: {
        message?: string | string[];
      };
    };
  }>;
  networkError?: { message?: string } | null;
};

export function extractErrorDetail(
  error: ApolloLikeError | null | undefined,
): string {
  const gqe = error?.graphQLErrors?.[0];
  const original = gqe?.extensions?.originalError?.message;

  if (
    Array.isArray(original) &&
    original.length > 0 &&
    typeof original[0] === "string"
  ) {
    return original[0];
  }
  if (typeof original === "string" && original.length > 0) {
    return original;
  }
  if (gqe?.message) {
    return gqe.message;
  }
  if (
    (!error?.graphQLErrors || error.graphQLErrors.length === 0) &&
    error?.networkError &&
    (error?.message === "Network Error" || error?.message === "Failed to fetch")
  ) {
    return "No se pudo conectar con el servidor backend. Verifica que el proceso esté en ejecución (los detalles del fallo aparecen en la consola del backend).";
  }
  if (error?.message) {
    return error.message;
  }
  return "Error desconocido";
}
