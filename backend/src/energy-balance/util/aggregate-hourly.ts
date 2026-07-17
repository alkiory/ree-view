/**
 * §3.37 — Aggregate 5-min REE demanda-tiempo-real ticks into 24 hourly
 * points for the `LiveDemandSnapshot.demandCurve` shape.
 *
 * POR QUÉ un util aparte (no método del servicio):
 *   - Transformación matemática pura sobre arrays. Sin I/O, sin DI,
 *     sin estado. Testeable al 100% en aislamiento sin instanciar
 *     el contenedor de NestJS ni mockear Axios/REE.
 *   - Compartirlo entre `ree-client.service.ts` (curva histórica) y
 *     `live-demand.service.ts` (curva live) evita drift entre los dos
 *     paths (un cambio solo en uno crea inconsistency silenciosa).
 *   - Buena locality: `util/` agrupa futuras pure functions.
 *
 * POR QUÉ "every 12th entry" (no average per hour):
 *   - REE publica ticks EXACTAMENTE cada 5 min — posición 0 = HH:00,
 *     posición 12 = (HH+1):00, ..., posición 276 = 23:00. Tomar la
 *     entrada en marca de hora da el valor "instantáneo" al cierre de
 *     cada hora, que es la semántica más natural para un AreaChart
 *     horario.
 *   - La media enmascararía la pendiente intra-horaria (e.g.
 *     madrugada con descenso monótono se flattenea artifactualmente).
 *
 * Shape REE (verbatim del probe 2026-07-14T00:00 → 2026-07-14T23:59):
 *   `values[i] = { value: number (MW), percentage: number, datetime: "YYYY-MM-DDTHH:MM:SS.sss+TZ" }`
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
  /** REE distinguishes series by `type` ('Real' | 'Prevista' | etc.); we
   *  intentionally preserve the literal type string (string-typed) for
   *  forward-compat with future items como 'Consumo bombeo' que REE pueda
   *  añadir. */
  type: string;
  values: { value: number; datetime: string }[];
}

export const TICKS_PER_HOUR = 12;

/** REE emite 24h × 12 ticks/h = 288 entradas por item. */
export const EXPECTED_TICKS_PER_DAY = 24 * TICKS_PER_HOUR;

/**
 * §3.43 — Toma un array de N valores 5-min y devuelve N/TICKS_PER_HOUR
 * puntos horarios (uno por bucket de 12 ticks). Antes (§3.37) exigía
 * exactamente 288 (24h × 12 ticks/h). Ahora acepta cualquier count
 * positivo múltiplo de TICKS_PER_HOUR — útil para polls de madrugada
 * donde REE aún no ha publicado los 288 ticks del día en curso. Esto
 * evita el patrón bug §3.42 (`buildDemandCurve` silencioso +
 * `lastReal.value` preservado → snapshot "incoherente" con curMW > 0
 * + curve=[] que el frontend no flageaba como degraded porque
 * `isDegradedSnapshot` §3.27 strict-AND requiere 3 sentinels en 0).
 *
 * Casos que aún lanzan throw (fail loud §3.21 — sin degrade
 * silencioso):
 *   - `count === 0`            → "empty values5min (expected at least 1 entry)"
 *   - `count % 12 !== 0`       → "count must be a positive multiple of
 *                                  {@link TICKS_PER_HOUR} (got N, would leave partial
 *                                  hour bucket)"
 *
 * TZ handling: `new Date(datetime)` parsea el ISO 8601 con offset
 * (e.g. "2026-07-14T00:00:00.000+02:00") correctamente. `getHours()`
 * retorna la hora en el offset del timestamp, NO en UTC. Por
 * seguridad usamos el slice del string para evitar drift entre
 * runners de tests en distintas TZ (el ISO incluye el offset
 * literal, no dependemos del clock del runner).
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
    // Slice del ISO "YYYY-MM-DDTHH:MM:SS.sss+TZ" → "HH" (chars 11..12).
    // Más robusto que `new Date(...).getHours()` porque no depende
    // de la TZ del runner (cf. tests TZ-independence §3.33).
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
 * De un array de items REE (`DemandaItem` con su `type` y `values[]`),
 * extrae las series `Real` y `Prevista` (identificadas por el literal
 * del atributo `type` que REE expone), las agrega a 24 puntos horarios
 * cada una, y devuelve el shape del `demandCurve`:
 *   `[{ h: "HHh", real: number, prevista: number }, ...]` (24 entries).
 *
 * Falla loud si falta alguno de los dos — un degraded state silencioso
 * aquí rompería el render del AreaChart sin error visible.
 *
 * POR QUÉ buscar por `type` literal y NO por id numérico:
 *   El id numérico (Real=2037, Prevista=2052) es internal de REE y
 *   puede cambiar. El `type` literal ('Real', 'Prevista') es el
 *   contrato semántico estable a través de versiones de la API y está
 *   ya extraído del probe. Si REE renumera ids en el futuro, este
 *   helper sigue funcionando sin cambios.
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
