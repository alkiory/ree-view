import { gql } from "@apollo/client";

/**
 * Query GET_LIVE_DEMAND → `getLiveSnapshot` en el backend.
 *
 * Cobertura UI completa (mapeo 1:1 con el shape consumido por
 * `frontend/src/components/cards/live-demand-card.tsx`):
 *   - `currentDemandMW`         → KPI "Demanda actual"
 *   - `maxForecastMW` + `minTodayMW` → KPIs adicionales
 *   - `renewablePercentageValue`     → KPI "% renovables" (futuro)
 *   - `timestamp`               → etiqueta "Última actualización"
 *   - `region`                  → cuáles de los 6 region slots se displayed
 *   - `demandCurve[]`           → serie horaria del AreaChart (real vs prevista)
 *   - `co2Emissions`            → opcional/null según el corte REE
 *
 * Por qué el campo `co2Emissions` se pide pero puede llegar `null`:
 *   REE no siempre expone intensidad de carbono en el mismo endpoint
 *   live; queda nullable como forward-compat. Si llega null, el
 *   frontend renderiza `—` (ver `frontend/src/components/cards/live-demand-card.tsx`).
 *
 * Phase 2 §3.31 — `$region: LiveDemandRegionSlug` agregado: cuando
 * el usuario switch-ea de "Nacional" a "Peninsular" (o cualquier otra),
 * el frontend emite UN refetch pasando el nuevo region como variable.
 * `useLiveDemand(region)` hook lo propaga automáticamente al query.
 *
 * Por qué `nullable: true` GraphQL en backend pero `null` en la
 * variable NO se envía desde frontend: el ApolloClient omite las
 * keys con `undefined` por default; sólo se mandan las que tienen
 * valor. La signatura del resolver backend acepta `input?: ...` para
 * tratar el "no se envía region" como "Nacional implícito".
 */
export const GET_LIVE_DEMAND = gql`
  query GetLiveSnapshot($region: LiveDemandRegionSlug) {
    getLiveSnapshot(input: { region: $region }) {
      currentDemandMW
      maxForecastMW
      minTodayMW
      renewablePercentageValue
      timestamp
      region
      co2Emissions
      demandCurve {
        h
        real
        prevista
      }
    }
  }
`;

/**
 * Phase 2 §3.31 — historical hourly archive query.
 *
 * El frontend invoca este query CUANDO el live snapshot está degraded
 * (zero-sentinels §3.27) y quiere mostrar la curva del día anterior
 * en su lugar. `date` se computa client-side como `yesterday` ISO format.
 *
 * Shape idéntico a `getLiveSnapshot` para swap-render sin type
 * complaints en el componente.
 *
 * `region` opcional con misma semántica que live.
 */
export const GET_HISTORICAL_HOURLY = gql`
  query GetHistoricalHourlySnapshot(
    $date: String!
    $region: LiveDemandRegionSlug
  ) {
    getHistoricalHourlySnapshot(input: { date: $date, region: $region }) {
      currentDemandMW
      maxForecastMW
      minTodayMW
      renewablePercentageValue
      timestamp
      region
      co2Emissions
      demandCurve {
        h
        real
        prevista
      }
    }
  }
`;
