import { useQuery, type ApolloError } from "@apollo/client";
import {
  GET_LIVE_DEMAND,
  GET_HISTORICAL_HOURLY,
} from "../queries/live-demand.query";

/**
 * Slug enum alineado 1:1 con `backend/src/energy-balance/dto/live-demand.input.ts:LiveDemandRegionSlug`.
 * El frontend lo usa como `useState<LiveDemandRegion>`. Cualquier
 * adición al enum backend requiere duplicar aquí + cross-checkear
 * `frontend/src/libs/design-tokens.ts:REGIONS`.
 *
 * Solo valores kebab-case (lo que la query variable + backend aceptan).
 */
export type LiveDemandRegion =
  "NACIONAL" | "PENINSULAR" | "BALEARES" | "CANARIAS" | "CEUTA" | "MELILLA";

/**
 * Display names alineados 1:1 con `frontend/src/libs/design-tokens.ts:REGIONS`.
 * El mapping display → slug está en `regionDisplayToSlug()` abajo.
 */
export const REGION_DISPLAY_TO_SLUG: Readonly<
  Record<string, LiveDemandRegion>
> = {
  Nacional: "NACIONAL",
  Peninsular: "PENINSULAR",
  Baleares: "BALEARES",
  Canarias: "CANARIAS",
  Ceuta: "CEUTA",
  Melilla: "MELILLA",
};

/**
 * Tipo de fila de la curva devuelta por `getLiveSnapshot`.
 *
 * Mantenido alineado con `BackendDTO.DemandCurvePoint` en
 * `backend/src/energy-balance/dto/live-demand.type.ts`. Si añades un
 * campo allí, añádelo también aquí y en `live-demand-card.tsx`.
 */
export interface DemandCurvePoint {
  h: string;
  real: number;
  prevista: number;
}

export interface LiveDemandData {
  currentDemandMW: number;
  maxForecastMW: number;
  minTodayMW: number;
  renewablePercentageValue: number;
  timestamp: string; // ISO 8601 from GraphQL Date scalar
  region?: LiveDemandRegion | null;
  demandCurve: DemandCurvePoint[];
  co2Emissions?: string | null;
}

/**
 * Hook Apollo para la sección «Datos en tiempo real».
 *
 * Phase 2 §3.31 update:
 *   - Acepta `region?: LiveDemandRegion` arg. Pasarlo o cambiarlo dispara
 *     Apollo `refetch` automáticamente porque la variable `$region` cambia.
 *   - `pollInterval: 60000` mantiene freshness con la cadencia de REE
 *     (~5min) sin saturar el throttler global (30 req/min).
 *   - Region pills onClick → setState → `useLiveDemand(newRegion)`
 *     AUTOMÁTICAMENTE emite la query con nuevo `$region` y el cache
 *     per-region key de Mongo evita storming.
 *
 * Por qué NO declaramos `errorPolicy: 'all'` aquí:
 *   el error se loggea en consola y Apollo lo propaga al componente;
 *   `live-demand-card.tsx` renderiza error state con
 *   `extractErrorDetail(error)` (mismo patrón que `energy-error-state.tsx`).
 */
export const useLiveDemand = (
  region?: LiveDemandRegion,
): {
  loadingLiveDemand: boolean;
  errorLiveDemand: ApolloError | undefined;
  liveDemand: LiveDemandData | undefined;
  refetchLiveDemand: () => Promise<unknown>;
} => {
  const {
    loading: loadingLiveDemand,
    error: errorLiveDemand,
    data,
    refetch: refetchLiveDemand,
  } = useQuery<{ getLiveSnapshot: LiveDemandData }>(GET_LIVE_DEMAND, {
    variables: { region: region ?? null },
    pollInterval: 60000,
    onError: (error) => {
      console.error("GraphQL Error (LiveDemand):", {
        name: error?.name,
        message: error?.message,
        graphQLErrors: error?.graphQLErrors?.map?.(
          (e: { message?: string }) => e?.message,
        ),
        networkError: (error?.networkError as Error | undefined)?.message,
      });
    },
  });

  return {
    loadingLiveDemand,
    errorLiveDemand,
    liveDemand: data?.getLiveSnapshot,
    refetchLiveDemand,
  };
};

/**
 * Phase 2 §3.31 — historical hourly archive hook.
 *
 * Recibe `date: string` (YYYY-MM-DD) y opcionalmente `region`. Sólo
 * se llama cuando el live snapshot está degraded (ver
 * `<HistoricalFallback />` en `live-demand-card.tsx`).
 *
 * Por qué separado del hook live:
 *   - El query es GraphQL distinto (`GET_HISTORICAL_HOURLY`).
 *   - El polling NO aplica: la data histórica no cambia. Sólo se
 *     re-fetchea si el usuario cambia region manualmente.
 *
 * Mantiene `date` en su firma porque el backend exige `String` (no
 * `Date`); el cliente computa "yesterday" localmente y lo manda.
 */
export const useHistoricalHourly = (
  date: string,
  region?: LiveDemandRegion,
): {
  loadingHistorical: boolean;
  errorHistorical: ApolloError | undefined;
  historicalHourly: LiveDemandData | undefined;
  refetchHistorical: () => Promise<unknown>;
} => {
  const {
    loading: loadingHistorical,
    error: errorHistorical,
    data,
    refetch: refetchHistorical,
  } = useQuery<{ getHistoricalHourlySnapshot: LiveDemandData }>(
    GET_HISTORICAL_HOURLY,
    {
      variables: { date, region: region ?? null },
      onError: (error) => {
        console.error("GraphQL Error (HistoricalHourly):", {
          name: error?.name,
          message: error?.message,
          graphQLErrors: error?.graphQLErrors?.map?.(
            (e: { message?: string }) => e?.message,
          ),
          networkError: (error?.networkError as Error | undefined)?.message,
        });
      },
    },
  );

  return {
    loadingHistorical,
    errorHistorical,
    historicalHourly: data?.getHistoricalHourlySnapshot,
    refetchHistorical,
  };
};

/**
 * Phase 2 §3.31 — fecha "ayer" en ISO 8601 (YYYY-MM-DD) para
 * `useHistoricalHourly`. Timezone-aware via `Date` constructor.
 *
 * Por qué zona local del browser (no UTC):
 *   El usuario ve la curva histórica del día ANTERIOR a su
 *   timezone, no al UTC de REE. Coincide con la intuición universal.
 *
 * POR QUÉ NO usamos `toISOString().slice(0, 10)` (UTC date):
 *   `toISOString()` siempre retorna en UTC. Para un usuario en
 *   Madrid (UTC+1/+2 según DST), a las 00:30 local el UTC actual
 *   todavía es `T23:30:00Z` del día anterior → `slice(0,10)` da
 *   AYER-EN-UTC, no ayer-en-local. Riesgo de mostrar la curva de
 *   anteayer en horas de madrugada.
 *   Los getters `getFullYear/getMonth/getDate` retornan componentes
 *   en zona LOCAL, así que el formato `YYYY-MM-DD` corresponde
 *   exactamente al calendario del usuario.
 *
 * POR QUÉ restamos 1 día con `setDate` (no restamos 24*60*60*1000ms):
 *   `setDate(now.getDate() - 1)` maneja correctamente DST boundaries
 *   (la resta de 24h puede perder/duplicar horas en cambios de horario).
 */
export const yesterdayISODate = (): string => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  // Componentes LOCAL: getFullYear/getMonth/getDate viven en tz del
  // browser. No usar `toISOString()` que siempre opera en UTC.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

/**
 * Phase 2 §3.31 — detection de live snapshot degradado.
 *
 * Phase 2 §3.27 establece que `Promise.allSettled` pone `0` /
 * `[]` / `{renewablePercentageValue: 0}` cuando los 3 fetches REE
 * fallan en simultáneo. El frontend NO quiere mostrar la UI con
 * esos zeros porque es indistinguible de casos edge genuine (no es
 * sólo cero, es "REE down").
 *
 * §3.42 — partial-degraded detection. El backend service.ts§3.37
 * puede retornar un snapshot "incoherente" cuando
 * `buildDemandCurve(items)` lanza throw silencioso (count !=288
 * en polls tempranos 01:00-04:00 local) pero `lastReal.value` se
 * extrajo OK: curMW > 0, curve = []. El symptom visible era
 * "Demanda actual = Mínima del día = mismo X GW" + "Sin curva".
 * Ese caso NO entraba aquí porque el strict-AND legacy de §3.27
 * requiere todos los 3 sentinels en cero.
 *
 * Nueva estrategia (2 puertas OR):
 *   1. **§3.42 partial-degraded**: `curve.length < 2` — sienta el
 *      precedente de que cualquier snapshot sin curva útil está
 *      degradado independientemente de curMW. Esto caza el bug
 *      "buildDemandCurve silencioso + lastReal preservado".
 *   2. **§3.27 legacy strict-AND**: `curMW === 0 && renewPct === 0
 *      && curve.length === 0` — preservado para el patrón REE
 *      completamente caído (3 fetches rechazan al unísono).
 *
 * Por qué `< 2` en lugar de `=== 0`: en un día muy temprano (poll
 * a las 00:05) podría haber 1 punto válido sin ser representativo.
 * El threshold `< 2` evita flicker entre "live" y "degraded" en
 * esos momentos transient sin perder el fallback histórico.
 */
export const isDegradedSnapshot = (
  snap: LiveDemandData | undefined,
): boolean => {
  if (!snap) return false;
  // §3.42 partial-degraded — la curva no es representativa.
  const partialDegraded =
    Array.isArray(snap.demandCurve) && snap.demandCurve.length < 2;
  // §3.27 legacy fully-degraded — todos los sentinels en 0.
  const fullyDegraded =
    snap.currentDemandMW === 0 &&
    snap.renewablePercentageValue === 0 &&
    Array.isArray(snap.demandCurve) &&
    snap.demandCurve.length === 0;
  return partialDegraded || fullyDegraded;
};

/**
 * Convierte `REGIONS` display name (de `design-tokens.ts`) a slug
 * kebab-case (lo que el hook + query esperan). Lo separamos del
 * `useState` directo para que el call site sea explícito.
 */
export const regionDisplayToSlug = (
  display: string,
): LiveDemandRegion | undefined => {
  return REGION_DISPLAY_TO_SLUG[display];
};

// Phase 2 §3.39 — MOCK FALLBACK MOVIDO a `mock-live-demand-card.tsx`.
//
// Antes (§3.32): `buildMockLiveDemand()` vivía aquí como fallback
// automático cuando live + historical fallaban. Eso hacía que
// producción mostrase datos SINTÉTICOS sin que el usuario lo pidiese
// explícitamente — violación de la promesa §3.37 ("100% datos reales
// por defecto").
//
// Ahora (§3.39): el mock es un componente separado
// (`MockLiveDemandCard`) que SOLO se monta en App.tsx cuando
// `import.meta.env.VITE_ENABLE_MOCK_FALLBACK === 'true'`. La data
// sintética + DEMO_CURVE viven dentro del componente (no se
// exportan), reduciendo blast radius: cualquier consumer futuro del
// hook sólo ve datos reales.
//
// Si tanto `useLiveDemand` como `useHistoricalHourly` fallan, el
// `LiveDemandCard` ahora renderiza un estado de error explícito
// (chip "ERROR" + mensaje "Sin curva horaria disponible") en vez
// de fabricar números.
