import { describe, expect, it } from 'vitest';

import { ApolloLikeError, extractErrorDetail } from '../extract-error-detail';

/**
 * Cobertura del priority chain de `extractErrorDetail` (ver §3.23 en
 * `agent-memory/CURRENT.md`). Énfasis explícito en la discriminator
 * tightness de la rama 3:
 *
 *   - POSITIVO: Chrome 88+ surfacea CORS-rejected prefights con
 *     `'Failed to fetch'` → branch 3 SÍ debe disparar.
 *   - NEGATIVO: 5xx upstream con `'Response not successful: Received
 *     status code N'` → branch 3 NO debe disparar; la rama 4 surfacea
 *     el código HTTP accionable al operador.
 *
 * Los stubs son literales `{...}` con la forma exacta de `ApolloLikeError`
 * (tipo local exportado en `extract-error-detail.ts`) a propósito. Esto
 * evita arrastrar `@apollo/client`'s `ApolloError` constructor + sus peer
 * deps (`graphql`, `zen-observable`) al test runtime, y mantiene la
 * unidad de testing al nivel del contrato que la función consume — no al
 * nivel del type que Apollo expone.
 */

const DEAD_BACKEND_MESSAGE =
  'No se pudo conectar con el servidor backend. Verifica que el proceso esté en ejecución (los detalles del fallo aparecen en la consola del backend).';

const makeError = (over: ApolloLikeError): ApolloLikeError => over;

describe('extractErrorDetail', () => {
  describe('branch 1a — extensions.originalError.message as string array', () => {
    it('returns the first element when the array is non-empty with strings', () => {
      const error = makeError({
        graphQLErrors: [
          {
            message: 'Bad Request Exception',
            extensions: {
              originalError: {
                message: [
                  'endDate must be at most 365 days after startDate',
                  'startDate must be in YYYY-MM-DD format',
                ],
              },
            },
          },
        ],
      });
      expect(extractErrorDetail(error)).toBe(
        'endDate must be at most 365 days after startDate',
      );
    });

    it('falls through to branch 2 when the array is empty', () => {
      const error = makeError({
        graphQLErrors: [
          {
            message: 'Bad Request Exception',
            extensions: { originalError: { message: [] as string[] } },
          },
        ],
      });
      expect(extractErrorDetail(error)).toBe('Bad Request Exception');
    });

    it('falls through when the first element is not a string (shape mismatch)', () => {
      // Hit defensivo: si un resolver futuro envía un shape inesperado
      // (e.g. `ValidationError[]` en vez de `string[]`), branch 1a NO
      // debe hacer `instanceof` o `as string` ciegamente.
      const error = makeError({
        graphQLErrors: [
          {
            message: 'Bad Request Exception',
            extensions: {
              originalError: {
                message: [
                  { field: 'endDate', message: 'too far' },
                ] as unknown as string[],
              },
            },
          },
        ],
      });
      expect(extractErrorDetail(error)).toBe('Bad Request Exception');
    });
  });

  describe('branch 1b — extensions.originalError.message as string', () => {
    it('returns the string verbatim when non-empty', () => {
      const error = makeError({
        graphQLErrors: [
          {
            message: 'Bad Request Exception',
            extensions: {
              originalError: {
                message: 'Failed to fetch energy data: REE 503',
              },
            },
          },
        ],
      });
      expect(extractErrorDetail(error)).toBe(
        'Failed to fetch energy data: REE 503',
      );
    });

    it('falls through to branch 2 when the string is empty', () => {
      // `error.message === ''` debe caer al siguiente branch (no mostrar
      // literal vacío). Por eso usamos `length > 0` en lugar de `??`.
      const error = makeError({
        graphQLErrors: [
          {
            message: 'Bad Request Exception',
            extensions: { originalError: { message: '' } },
          },
        ],
      });
      expect(extractErrorDetail(error)).toBe('Bad Request Exception');
    });
  });

  describe('branch 2 — GraphQL syntax error path', () => {
    it('returns gqe.message when originalError is absent but graphQLErrors is present', () => {
      const error = makeError({
        graphQLErrors: [{ message: 'Expected Name, found "}"' }],
      });
      expect(extractErrorDetail(error)).toBe('Expected Name, found "}"');
    });
  });

  describe('branch 3 — dead backend diagnostic (discriminator tightness)', () => {
    it('returns the Spanish dead-backend message for "Network Error" (Apollo v3 fetch failure)', () => {
      const error = makeError({
        message: 'Network Error',
        networkError: { message: 'fetch failed' },
      });
      expect(extractErrorDetail(error)).toBe(DEAD_BACKEND_MESSAGE);
    });

    it('returns the Spanish dead-backend message for "Failed to fetch" (Chrome 88+ CORS)', () => {
      // Ver §3.23 — discriminador ortopédico para CORS-rejected prefights
      // que Chrome 88+ surfacea con este string exacto.
      const error = makeError({
        message: 'Failed to fetch',
        networkError: { message: 'TypeError: Failed to fetch' },
      });
      expect(extractErrorDetail(error)).toBe(DEAD_BACKEND_MESSAGE);
    });

    it('does NOT trigger branch 3 for ServerError 5xx — falls through to branch 4 (discriminator tightness, negative case)', () => {
      // El discriminator de Apollo ServerError es el prefijo literal
      // `"Response not successful: Received status code N"`. NO matchea
      // con `'Network Error'` ni `'Failed to fetch'`, así que branch 3
      // queda inactiva y branch 4 surfacea el código HTTP — exactamente
      // lo que el operador necesita para diagnosticar 5xx upstream REE.
      const error = makeError({
        message: 'Response not successful: Received status code 502',
        networkError: { message: 'Server Error' },
      });
      expect(extractErrorDetail(error)).toBe(
        'Response not successful: Received status code 502',
      );
    });

    it('does NOT trigger branch 3 when graphQLErrors has entries — priority respected', () => {
      // Si por alguna razón un ApolloError trae AMBOS `networkError` y
      // `graphQLErrors`, la priority chain debe respetar 1/2 antes que 3.
      // Caso real: en `useErrorMessage` algunos hooks loggean ambos.
      const error = makeError({
        message: 'Network Error',
        networkError: { message: 'fetch failed' },
        graphQLErrors: [
          {
            message: 'Bad Request Exception',
            extensions: {
              originalError: {
                message: 'startDate must be in YYYY-MM-DD format',
              },
            },
          },
        ],
      });
      expect(extractErrorDetail(error)).toBe(
        'startDate must be in YYYY-MM-DD format',
      );
    });
  });

  describe('branch 4 — error.message fallback', () => {
    it('returns error.message as-is when it is the only actionable signal', () => {
      // No graphQLErrors, no networkError matching discriminator,
      // message es timeout/parse error/etc.
      const error = makeError({ message: 'timeout exceeded 30s' });
      expect(extractErrorDetail(error)).toBe('timeout exceeded 30s');
    });
  });

  describe('branch 5 — last-resort fallback', () => {
    it('returns "Error desconocido" for null error', () => {
      expect(extractErrorDetail(null)).toBe('Error desconocido');
    });

    it('returns "Error desconocido" for undefined error', () => {
      expect(extractErrorDetail(undefined)).toBe('Error desconocido');
    });

    it('returns "Error desconocido" for an empty object', () => {
      expect(extractErrorDetail({})).toBe('Error desconocido');
    });
  });
});
