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
 * Phase 2 §3.31 — detection estricta de live snapshot degradado.
 *
 * Phase 2 §3.27 establece que `Promise.allSettled` pone `0` /
 * `[]` / `{renewablePercentageValue: 0}` cuando los 3 fetches REE
 * fallan en simultáneo. El frontend NO quiere mostrar la UI con
 * esos zeros porque es indistinguible de casos edge genuine (no es
 * sólo cero, es "REE down").
 *
 * Estrategia: STRICT AND — todos los 3 sentinels coinciden al
 * mismo tiempo. Cubre:
 *   - `Promise.allSettled` 3-fail completo (ráfaga REE caída).
 *   - Cache stale con all-zero snapshot (poco probable; revisión #18).
 * No cubre:
 *   - Fallos individuales (current ok pero curve vacía). Esto
 *     deja room para un path degradado parcial sin cambiar UI,
 *     porque al menos 1 de los campos sí tiene valor.
 *
 * Por qué strict en lugar de "any == 0": genuine night-time values
 * pueden ser ~0 MW (e.g. madrugada con renewable=0) — el strict AND
 * evita sobrealarma en esos casos genuinos.
 */
export const isDegradedSnapshot = (
  snap: LiveDemandData | undefined,
): boolean => {
  if (!snap) return false;
  return (
    snap.currentDemandMW === 0 &&
    snap.renewablePercentageValue === 0 &&
    Array.isArray(snap.demandCurve) &&
    snap.demandCurve.length === 0
  );
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

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 §3.32 — MOCK FALLBACK cuando REE upstream falla (4xx/5xx).
//
// Cuando AMBOS live + historical fallan (cadena entera REE caída),
// el componente `live-demand-card.tsx` debe mostrar SIEMPRE algo al
// usuario, no "Sin curva horaria disponible." — UX percibida como
// error cuando realidad es un upstream-down transitorio.
//
// Estos datos son SINTÉTICOS. El chip "DEMO" + footer "Datos
// sintéticos · NO ES REAL" hacen explícito el carácter de mock. El
// PulseDot animado del "EN VIVO" se omite en el chip mock para
// reforzar visualmente que NO es streaming.
//
// Shape DEMO_CURVE (24 horas, MW): representa una curva plausible
// de demanda española: mínimo 4-5am (~17.5 GW), pico vespertino
// 20h (~36 GW). `real === prevista` porque no tenemos forecast
// sintético por separado (el dato upstream tampoco lo tiene claro
// en histórico, per §3.31 forecast endpoint es #21 outstanding).
// ─────────────────────────────────────────────────────────────────────────────

const DEMO_CURVE: readonly DemandCurvePoint[] = [
  { h: "00h", real: 22500, prevista: 22500 },
  { h: "01h", real: 21000, prevista: 21000 },
  { h: "02h", real: 19500, prevista: 19500 },
  { h: "03h", real: 18300, prevista: 18300 },
  { h: "04h", real: 17500, prevista: 17500 },
  { h: "05h", real: 18100, prevista: 18100 },
  { h: "06h", real: 21000, prevista: 21000 },
  { h: "07h", real: 26500, prevista: 26500 },
  { h: "08h", real: 30500, prevista: 30500 },
  { h: "09h", real: 32500, prevista: 32500 },
  { h: "10h", real: 32000, prevista: 32000 },
  { h: "11h", real: 31000, prevista: 31000 },
  { h: "12h", real: 29500, prevista: 29500 },
  { h: "13h", real: 29000, prevista: 29000 },
  { h: "14h", real: 28500, prevista: 28500 },
  { h: "15h", real: 28000, prevista: 28000 },
  { h: "16h", real: 27800, prevista: 27800 },
  { h: "17h", real: 28500, prevista: 28500 },
  { h: "18h", real: 30500, prevista: 30500 },
  { h: "19h", real: 33500, prevista: 33500 },
  { h: "20h", real: 36000, prevista: 36000 },
  { h: "21h", real: 34500, prevista: 34500 },
  { h: "22h", real: 30000, prevista: 30000 },
  { h: "23h", real: 25500, prevista: 25500 },
] as readonly DemandCurvePoint[];

/**
 * Sync helper que produce un `LiveDemandData` compatible con el shape
 * del backend. El caller decide cuándo invocar (en `live-demand-card.tsx`,
 * cuando `isDegraded && !validHistoricalAvailable`).
 *
 * Phase 2 §3.32 — POLÍTICA DE REGION:
 *   SIN parámetro region. La intención es explícita: el mock siempre
 *   devuelve `region: 'nacional'` independientemente de qué pill
 *   tenga el user seleccionado. Razón: DEMO_CURVE es Nacional-plausible
 *   y no tiene variantes per-region en v1; override hardcoded alinea
 *   schema-level honesty con shape-level honesty.
 *   Future (#33 outstanding): per-region mock families — en ese caso
 *   reintroducir el param `region?: LiveDemandRegion`.
 */
export const buildMockLiveDemand = (): LiveDemandData => {
  const reals = DEMO_CURVE.map((p) => p.real);
  const max = Math.max(...reals);
  const min = reals.reduce(
    (acc, r) => Math.min(acc, r),
    Number.POSITIVE_INFINITY,
  );
  const currentMW = DEMO_CURVE[DEMO_CURVE.length - 1]?.real ?? 25000;
  return {
    currentDemandMW: currentMW,
    maxForecastMW: max,
    minTodayMW: min,
    renewablePercentageValue: 45,
    timestamp: new Date().toISOString(),
    region: "nacional",
    demandCurve: DEMO_CURVE.map((p) => ({ ...p })),
    co2Emissions: "142 gCO₂eq/kWh",
  };
};
