import { useQuery, type ApolloError } from "@apollo/client";
import {
  GET_LIVE_DEMAND,
  GET_HISTORICAL_HOURLY,
} from "../queries/live-demand.query";

/**
 * Slugs canónicos de las regiones eléctricas (Nacional / Peninsular /
 * Baleares / Canarias / Ceuta / Melilla).
 */
export type LiveDemandRegion =
  "NACIONAL" | "PENINSULAR" | "BALEARES" | "CANARIAS" | "CEUTA" | "MELILLA";

/** Mapping display → slug de las regiones. */
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

/** Punto de la curva horaria de demanda. */
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
  timestamp: string;
  region?: LiveDemandRegion | null;
  demandCurve: DemandCurvePoint[];
  co2Emissions?: string | null;
}

/**
 * Hook Apollo para la sección «Datos en tiempo real». Poll de 60s
 * sin saturar el throttler (30 req/min). El cambio de `region`
 * dispara un refetch automático.
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
 * Hook para snapshot histórico horaria (ayer por defecto). Sólo
 * invoca cuando el live está degraded; el polling no aplica porque
 * la data histórica no cambia. `date` es `YYYY-MM-DD`.
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
 * Devuelve la fecha "ayer" en ISO 8601 (`YYYY-MM-DD`) usando getters
 * locales del browser (no UTC) para que coincida con el calendario
 * del usuario.
 */
export const yesterdayISODate = (): string => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

/**
 * Detecta si el snapshot live está degraded (para activar fallback
 * histórico en la UI). Dos puertas OR: curva vacía (partial-degraded)
 * o todos los sentinels en 0 (fully-degraded).
 *
 * Umbral estricto `=== 0` (no `< 2`) porque desde que `aggregateHourly`
 * acepta counts de madrugada ≥ 12, una curva de 1-11 buckets es data
 * legítima temprana que el usuario merece ver, no un fallback histórico.
 */
export const isDegradedSnapshot = (
  snap: LiveDemandData | undefined,
): boolean => {
  if (!snap) return false;
  const partialDegraded =
    Array.isArray(snap.demandCurve) && snap.demandCurve.length === 0;
  const fullyDegraded =
    snap.currentDemandMW === 0 &&
    snap.renewablePercentageValue === 0 &&
    Array.isArray(snap.demandCurve) &&
    snap.demandCurve.length === 0;
  return partialDegraded || fullyDegraded;
};

/** Convierte el display name de `REGIONS` (design-tokens) al slug. */
export const regionDisplayToSlug = (
  display: string,
): LiveDemandRegion | undefined => {
  return REGION_DISPLAY_TO_SLUG[display];
};
