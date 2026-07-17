import { gql } from "@apollo/client";

/**
 * Query `getLiveSnapshot`. Cubre el shape consumido por
 * `live-demand-card.tsx`: KPIs (`currentDemandMW`, `maxForecastMW`,
 * `minTodayMW`, `renewablePercentageValue`), curva horaria del
 * AreaChart y metadatos (timestamp, region, co2Emissions opcional).
 *
 * `$region` opcional: omitirla = Nacional implícito en el backend.
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
 * Query `getHistoricalHourlySnapshot`. Shape idéntico a live para
 * swap-render sin type checker complaints en el componente.
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
