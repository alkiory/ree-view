import { describe, expect, it } from 'vitest';

import {
  aggregateHourly,
  buildDemandCurve,
  EXPECTED_TICKS_PER_DAY,
  TICKS_PER_HOUR,
  type DemandItemRaw,
} from '../aggregate-hourly';

/**
 * Generador de N ticks 5-min a partir de un ISO base.
 * El valor se construye como 1000 + i*10 (monótono ascendente) para
 * detectar claramente errors de orden o de bucketing.
 */
function make5minValues(
  baseIso: string = '2026-07-14T00:00:00.000+02:00',
  count: number = EXPECTED_TICKS_PER_DAY,
): { value: number; datetime: string }[] {
  // TZ-safe string-based ISO parser. NO `new Date()` — Date convierte
  // a la TZ del runner, rompiendo el contrato cross-TZ.
  const m = baseIso.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):\d{2}\.\d{3}(Z|[+-]\d{2}:\d{2})$/,
  );
  if (!m) throw new Error(`bad iso: ${baseIso}`);
  const [, yyyy, MM, dd, hh, mm, offset] = m;
  const startTotal = parseInt(hh) * 60 + parseInt(mm);
  const out: { value: number; datetime: string }[] = [];
  for (let i = 0; i < count; i++) {
    const tot = startTotal + i * 5;
    const dayShift = Math.floor(tot / 1440);
    const dMin = tot - dayShift * 1440;
    const newDate = new Date(Date.UTC(+yyyy, +MM - 1, +dd));
    newDate.setUTCDate(newDate.getUTCDate() + dayShift);
    const newY = newDate.getUTCFullYear();
    const newM = String(newDate.getUTCMonth() + 1).padStart(2, '0');
    const newD = String(newDate.getUTCDate()).padStart(2, '0');
    const newH = String(Math.floor(dMin / 60)).padStart(2, '0');
    const newMi = String(dMin % 60).padStart(2, '0');
    out.push({
      value: 1000 + i * 10,
      datetime: `${newY}-${newM}-${newD}T${newH}:${newMi}:00.000${offset}`,
    });
  }
  return out;
}

describe('aggregateHourly (pure function)', () => {
  it('aggregates exactly 288 5-min ticks into 24 hour marks [00h..23h]', () => {
    const ticks = make5minValues();
    expect(ticks.length).toBe(EXPECTED_TICKS_PER_DAY);
    expect(EXPECTED_TICKS_PER_DAY).toBe(288);
    expect(TICKS_PER_HOUR).toBe(12);

    const hourly = aggregateHourly(ticks);

    expect(hourly).toHaveLength(24);
    // Cada punto referencia exactamente la entrada multiplo-de-12.
    expect(hourly[0].h).toBe('00h');
    expect(hourly[1].h).toBe('01h');
    expect(hourly[12].h).toBe('12h');
    expect(hourly[23].h).toBe('23h');
    // Cada hora apunta al tick con i = hour*TICKS_PER_HOUR.
    expect(hourly[0].value).toBe(1000 + 0 * TICKS_PER_HOUR * 10); // 1000
    expect(hourly[1].value).toBe(1000 + 1 * TICKS_PER_HOUR * 10); // 1120
    expect(hourly[23].value).toBe(1000 + 23 * TICKS_PER_HOUR * 10); // 3760
    // Datetime preservado verbatim (no manipulación silenciosa).
    expect(hourly[0].datetime).toBe('2026-07-14T00:00:00.000+02:00');
    expect(hourly[23].datetime.startsWith('2026-07-14T23:00')).toBe(true);
  });

  it('rejects counts that are zero or not positive multiples of TICKS_PER_HOUR (partial-day semantics)', () => {
    // Preserva fail-loud sin descartar datasets parciales (count=12,
    // 24, 144 → válidos, cubiertos en el bloque count-flexible abajo).
    const notMul287 = make5minValues('2026-07-14T00:00:00.000+02:00', 287);
    expect(() => aggregateHourly(notMul287)).toThrow(
      /count must be a positive multiple of 12.*got 287/i,
    );
    const notMul289 = make5minValues('2026-07-14T00:00:00.000+02:00', 289);
    expect(() => aggregateHourly(notMul289)).toThrow(
      /count must be a positive multiple of 12.*got 289/i,
    );
    const notMul25 = make5minValues('2026-07-14T00:00:00.000+02:00', 25);
    expect(() => aggregateHourly(notMul25)).toThrow(
      /count must be a positive multiple of 12.*got 25/i,
    );
    const empty: { value: number; datetime: string }[] = [];
    expect(() => aggregateHourly(empty)).toThrow(/empty values5min/i);
  });

  it('extracts the hour mark from the ISO string regardless of runner TZ (TZ-independence)', () => {
    // TZ-portability: el helper extrae "HH" del string ISO en chars
    // 11..13 (sin invocar Date.getHours que dependería del reloj
    // del runner). Esta test ejercita este path con strings en
    // distintas zonas horarias declaradas en el ISO — el helper
    // debe producir "07h" y "15h" incluso corriendo en UTC server.
    const winterCest = make5minValues('2026-01-15T07:00:00.000+01:00'); // CET/CEST Madrid invierno
    const summerCest = make5minValues('2026-07-15T15:00:00.000+02:00'); // CEST Madrid verano
    // Para una serie que NO empieza a las 00:00, idx N corresponde a la
    // hora `(hh_base + N) % 24`. idx 0 = primera marca de hora del run.
    // Verificamos en idx 0 (= hora base de la serie, no idx arbitrario).
    expect(aggregateHourly(winterCest)[0].h).toBe('07h');
    expect(aggregateHourly(summerCest)[0].h).toBe('15h');
    // Edge: UTC explícito (REE no emite esto, pero lock del contrato).
    const utcSeries = make5minValues('2026-07-14T22:00:00.000Z');
    expect(aggregateHourly(utcSeries)[0].h).toBe('22h');
    // Malformed datetime → fail loud (no degrade silencioso).
    const malformed = make5minValues();
    malformed[0] = { value: 0, datetime: 'not-an-iso' };
    expect(() => aggregateHourly(malformed)).toThrow(/malformed datetime/);
  });
});

describe('buildDemandCurve (pure function)', () => {
  it('zips Real + Prevista 24h series into the demandCurve shape', () => {
    const real = make5minValues();
    const prevista = make5minValues();
    const items: DemandItemRaw[] = [
      { type: 'Real', values: real },
      { type: 'Prevista', values: prevista },
    ];
    const curve = buildDemandCurve(items);

    expect(curve).toHaveLength(24);
    expect(curve[0]).toEqual({
      h: '00h',
      real: 1000,
      prevista: 1000,
    });
    expect(curve[12]).toEqual({
      h: '12h',
      real: 1000 + 12 * TICKS_PER_HOUR * 10,
      prevista: 1000 + 12 * TICKS_PER_HOUR * 10,
    });
  });

  it('throws if Real item is missing (no silent degradation)', () => {
    const items: DemandItemRaw[] = [
      { type: 'Prevista', values: make5minValues() },
    ];
    expect(() => buildDemandCurve(items)).toThrow(
      /missing Real\/Prevista in REE response.*got.*Prevista/,
    );
  });

  it('throws if Prevista item is missing (no silent degradation)', () => {
    const items: DemandItemRaw[] = [
      { type: 'Real', values: make5minValues() },
    ];
    expect(() => buildDemandCurve(items)).toThrow(
      /missing Real\/Prevista/,
    );
  });
});

/**
 * §3.43 — Count-flexible partial-day semantics. Antes de este cambio,
 * `aggregateHourly` solo aceptaba 288 ticks (24h × 12/h). Falta de
 * ticks durante polls de madrugada (e.g. 03:00-04:00 con ~12-50
 * ticks publicados por REE) hacía que `buildDemandCurve` lanzase
 * throw → `curve = []` (catch silencioso §3.27) pero `lastReal.value`
 * preservado, generando el snapshot "incoherente" que el frontend
 * ya cazaba con Fix #1 (§3.42 partial-degraded gate). Con esta
 * fix, los polls tempranos producen curvas honestas (1-12 buckets)
 * y el umbral `< 2` del gate frontend retiene curva válida.
 */
describe('aggregateHourly count-flexible (§3.43 partial-day)', () => {
  it('accepts 12 ticks → 1 hour bucket (very early morning poll)', () => {
    const ticks = make5minValues('2026-07-14T03:00:00.000+02:00', 12);
    const hourly = aggregateHourly(ticks);
    expect(hourly).toHaveLength(1);
    expect(hourly[0].h).toBe('03h');
  });

  it('accepts 24 ticks → 2 hour buckets (mid morning poll)', () => {
    const ticks = make5minValues('2026-07-14T03:00:00.000+02:00', 24);
    const hourly = aggregateHourly(ticks);
    expect(hourly).toHaveLength(2);
    expect(hourly[0].h).toBe('03h');
    expect(hourly[1].h).toBe('04h');
  });

  it('accepts 144 ticks → 12 hour buckets (half day)', () => {
    const ticks = make5minValues('2026-07-14T03:00:00.000+02:00', 144);
    const hourly = aggregateHourly(ticks);
    expect(hourly).toHaveLength(12);
    expect(hourly[0].h).toBe('03h');
    expect(hourly[11].h).toBe('14h');
  });

  it('accepts 288 ticks → 24 hour buckets (full day, backward compat)', () => {
    // 288 sigue retornando 24 buckets con etiquetas 00h..23h.
    // Lock contra regression.
    const ticks = make5minValues('2026-07-14T00:00:00.000+02:00', 288);
    const hourly = aggregateHourly(ticks);
    expect(hourly).toHaveLength(24);
    expect(hourly[0].h).toBe('00h');
    expect(hourly[23].h).toBe('23h');
  });

  it('rejects count=25 (not a multiple of 12) — anti-regression', () => {
    // Listar explícitamente evita off-by-one cuando el threshold se
    // tunee a 24 más adelante.
    const ticks = make5minValues('2026-07-14T00:00:00.000+02:00', 25);
    expect(() => aggregateHourly(ticks)).toThrow(
      /count must be a positive multiple of 12.*got 25/i,
    );
  });
});
