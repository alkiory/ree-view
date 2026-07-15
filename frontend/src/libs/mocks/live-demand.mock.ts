import { useEffect, useState } from 'react';

// Valores constantes de la sección (los reales vendrán del endpoint Tier-3).
export interface LiveDemandSnapshot {
  currentDemandMW: number;
  currentDemandGW: string;
  renewablePercentageValue: number;
  renewablePercentage: string;
  maxForecastGW: string;
  minTodayGW: string;
  co2Emissions: string;
  timestamp: Date;
}

const BASE_SNAPSHOT: LiveDemandSnapshot = {
  currentDemandMW: 33200,
  currentDemandGW: '33.2 GW',
  renewablePercentageValue: 47.3,
  renewablePercentage: '47.3%',
  maxForecastGW: '34.1 GW',
  minTodayGW: '20.1 GW',
  co2Emissions: '148 g/kWh',
  timestamp: new Date(),
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const jitter = (magnitude: number): number => (Math.random() * 2 - 1) * magnitude;

/**
 * Mock feed para la sección «Datos en tiempo real».
 *
 * Mientras no exista endpoint real, este hook emula una fuente viva
 * con `setInterval` y fluctuación determinista (mismo rango, ruido acotado).
 *
 * Decisión de diseño (ver CURRENT.md §6 Deuda Técnica — punto sobre
 * endpoint demanda real pendiente Fase 2): NO tocar Apollo / backend.
 *
 * Cleanup del interval está garantizado en el return del `useEffect`.
 */
export function useMockLiveDemand(intervalMs = 3000): LiveDemandSnapshot {
  const [snap, setSnap] = useState<LiveDemandSnapshot>(BASE_SNAPSHOT);

  useEffect(() => {
    const id = setInterval(() => {
      setSnap((prev) => {
        const nextMW = Math.round(clamp(prev.currentDemandMW + jitter(800), 20_000, 40_000));
        const nextPctValue = clamp(prev.renewablePercentageValue + jitter(2), 0, 100);
        const nextPct = Number(nextPctValue.toFixed(1));
        return {
          ...prev,
          currentDemandMW: nextMW,
          currentDemandGW: `${(nextMW / 1000).toFixed(1)} GW`,
          renewablePercentageValue: nextPct,
          renewablePercentage: `${nextPct.toFixed(1)}%`,
          timestamp: new Date(),
        };
      });
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return snap;
}
