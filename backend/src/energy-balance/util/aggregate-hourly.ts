/**
 * Pure functions para transformar los items crudos de `demanda-tiempo-real`
 * (REE, ticks cada 5 min) en el shape `demandCurve` del
 * `LiveDemandSnapshot` (24 puntos horarios). Sin I/O ni estado,
 * testeable en aislamiento completo.
 *
 * Shape REE verbatim:
 *   `values[i] = { value: number (MW), percentage, datetime: "YYYY-MM-DDTHH:MM:SS.sss+TZ" }`
 *
 * Shape LiveDemandSnapshot.demandCurve:
 *   `[{ h: "HHh", real: number, prevista: number }, ...]` (24 entries)
 */

export interface HourlyPoint {
  h: string;
  value: number;
  datetime: string;
}

export interface DemandItemRaw {
  type: string;
  values: { value: number; datetime: string }[];
}

export const TICKS_PER_HOUR = 12;

/** REE emite 24h × 12 ticks/h = 288 entradas por item. */
export const EXPECTED_TICKS_PER_DAY = 24 * TICKS_PER_HOUR;

/**
 * Toma un array de N valores 5-min y devuelve `N / TICKS_PER_HOUR`
 * puntos horarios (uno por bucket de 12 ticks). Acepta cualquier count
 * positivo múltiplo de `TICKS_PER_HOUR` — útil para polls tempranos
 * donde REE aún no ha publicado los 288 ticks diarios.
 *
 * Falla loud (no degrade silencioso) cuando `count === 0` o no es
 * múltiplo de `TICKS_PER_HOUR`.
 *
 * TZ handling: la etiqueta `h` se extrae con slice del ISO string (no
 * `getHours()`) para que los tests sean TZ-independientes.
 */
export function aggregateHourly(
  values5min: { value: number; datetime: string }[],
): HourlyPoint[] {
  if (values5min.length === 0) {
    throw new Error(
      `aggregateHourly: empty values5min (expected at least 1 entry)`,
    );
  }
  if (values5min.length % TICKS_PER_HOUR !== 0) {
    throw new Error(
      `aggregateHourly: count must be a positive multiple of ${TICKS_PER_HOUR} (got ${values5min.length}, would leave partial hour bucket)`,
    );
  }
  const totalBuckets = values5min.length / TICKS_PER_HOUR;
  const result: HourlyPoint[] = [];
  for (let hour = 0; hour < totalBuckets; hour++) {
    const entry = values5min[hour * TICKS_PER_HOUR];
    if (!entry) {
      throw new Error(`aggregateHourly: missing 5-min entry at hour=${hour}`);
    }
    const hh = entry.datetime.slice(11, 13);
    if (!/^\d{2}$/.test(hh)) {
      throw new Error(
        `aggregateHourly: malformed datetime at hour=${hour}: "${entry.datetime}" (expected YYYY-MM-DDTHH:MM:SS.sss+TZ)`,
      );
    }
    result.push({
      h: `${hh}h`,
      value: Number(entry.value ?? 0),
      datetime: entry.datetime,
    });
  }
  return result;
}

/**
 * De los items REE (`DemandaItem`), extrae las series `Real` y
 * `Prevista`, agrega cada una a 24 puntos horarios y devuelve el
 * shape del `demandCurve`. Falla loud si falta alguna (un degraded
 * silencioso rompería el render del AreaChart sin error visible).
 *
 * La búsqueda por `type` literal (no por id numérico) es estable
 * cross-versiones de la API REE.
 */
export function buildDemandCurve(
  items: DemandItemRaw[],
): { h: string; real: number; prevista: number }[] {
  const realItem = items.find((it) => it.type === 'Real');
  const previstaItem = items.find((it) => it.type === 'Prevista');
  if (!realItem || !previstaItem) {
    const found = items.map((it) => it.type).join(', ');
    throw new Error(
      `buildDemandCurve: missing Real/Prevista in REE response (got: [${found || 'empty'}])`,
    );
  }
  const realHourly = aggregateHourly(realItem.values);
  const previstaHourly = aggregateHourly(previstaItem.values);
  if (realHourly.length !== previstaHourly.length) {
    throw new Error(
      `buildDemandCurve: Real (${realHourly.length} pts) vs Prevista (${previstaHourly.length} pts) length mismatch`,
    );
  }
  return realHourly.map((r, i) => ({
    h: r.h,
    real: r.value,
    prevista: previstaHourly[i].value,
  }));
}
