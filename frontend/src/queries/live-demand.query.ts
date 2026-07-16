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
 *   - `demandCurve[]`           → serie horaria del AreaChart (real vs prevista)
 *   - `co2Emissions`            → opcional/null según el corte REE
 *
 * Por qué el campo `co2Emissions` se pide pero puede llegar `null`:
 *   REE no siempre expone intensidad de carbono en el mismo endpoint
 *   live; queda nullable como forward-compat. Si llega null, el
 *   frontend renderiza `—` (ver `frontend/src/components/cards/live-demand-card.tsx`).
 */
export const GET_LIVE_DEMAND = gql`
  query GetLiveSnapshot {
    getLiveSnapshot {
      currentDemandMW
      maxForecastMW
      minTodayMW
      renewablePercentageValue
      timestamp
      co2Emissions
      demandCurve {
        h
        real
        prevista
      }
    }
  }
`;
