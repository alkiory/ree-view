import { useQuery, type ApolloError } from "@apollo/client";
import { GET_LIVE_DEMAND } from "../queries/live-demand.query";

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
  demandCurve: DemandCurvePoint[];
  co2Emissions?: string | null;
}

/**
 * Hook Apollo para la sección «Datos en tiempo real».
 *
 * `pollInterval: 60000` mantiene freshness con la cadencia de REE (~5min)
 * sin saturar el throttler global (30 req/min). Si la UI ya tiene un
 * snapshot reciente en cache, Apollo responde con el cache antes de
 * refetch (debido a `cache-and-network` policy por default).
 *
 * El hook **desempaqueta** la envoltura `{ getLiveSnapshot: ... }`
 * para que el consumidor acceda directamente con `liveDemand?.x`. Esto
 * evita el patrón de doble optional-chaining (`liveDemand?.getLiveSnapshot?.x`)
 * en cada KPI del card.
 *
 * Por qué NO declaramos `errorPolicy: 'all'` aquí:
 *   el error se loggea en consola y Apollo lo propaga al componente;
 *   `live-demand-card.tsx` renderiza error state con
 *   `extractErrorDetail(error)` (mismo patrón que
 *   `energy-error-state.tsx`). Si en el futuro queremos silenciar el
 *   error en consola para esta sección (porque el poll repetirá en
 *   60s), añadir `errorPolicy: 'all'` localmente como en
 *   `useEnergyData.ts`.
 *
 * `notifyOnNetworkStatusChange`: NO lo activamos — el KPI "Última
 * actualización" ya tiene su propio `setInterval(1s)` separado en el
 * componente, y un re-render cada 60s extra es ruido. Apollo considera
 * loading=false mientras sirve cache anterior, así que la UI no
 * flicker.
 */
const useLiveDemand = (): {
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

export default useLiveDemand;
