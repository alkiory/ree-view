import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LiveDemandService } from '../live-demand.service';
import { ReeClientService } from '../ree-client.service';
import { LiveDemand } from '../../schemas/live-demand.schema';
import { LiveDemandHistorical } from '../../schemas/live-demand-historical.schema';
import type { DemandItemRaw } from '../../util/aggregate-hourly';

/**
 * §3.37 spec — refactor from 3-fetch to 2-fetch.
 *
 *   - `fetchCurrentDemand` + `fetchDailyDemandCurve` se eliminan del
 *     contrato de ree-client.service.ts.
 *   - `fetchDemandaTiempoReal` (canonical nuevo) reemplaza ambos.
 *   - `fetchGenerationMix` se preserva intacto (endpoint separado).
 *   - La curva horaria se construye con `util/aggregate-hourly.ts:
 *     buildDemandCurve(items)` — pure function testeada en su propio
 *     spec; aquí solo verificamos el wire-up del servicio.
 *
 * Cobertura:
 *   - Cache miss (fresh service)    → 2× fetch REE paralelo + persist.
 *   - Cache miss (real=0 only)     → minTodayMW fallback al currentMW.
 *   - Cache hit                    → 0 fetch REE.
 *   - Resilience (1 fetch fails)   → partial snapshot con defaults.
 *   - Resilience (2 fetches fail)  → all-zero snapshot.
 *   - Integration historical end-to-end (getHistoricalHourlySnapshot) ← NEW
 */

const BASE_ISO = '2026-07-14T00:00:00.000+02:00';

/**
 * Helper — genera el array de 288 valores 5-min esperado por
 * `aggregateHourly`. Cada hora toma un valor de `byHour[h]` (default 0).
 * Datetime generado programmaticamente con offset +02:00.
 */
function makeValues(
  byHour: Record<number, number>,
): { value: number; datetime: string }[] {
  // TZ-safe string-only parser (no \`new Date()\` que convierte a TZ del
  // runner — rompe cross-TZ, ver §3.33 Fix B).
  const m = BASE_ISO.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):\d{2}\.\d{3}([+-]\d{2}:\d{2})$/,
  );
  if (!m) throw new Error(`bad BASE_ISO: ${BASE_ISO}`);
  const [, yyyy, MM, dd, hh, mm, offset] = m;
  const startTotal = parseInt(hh) * 60 + parseInt(mm);
  const out: { value: number; datetime: string }[] = [];
  for (let i = 0; i < 288; i++) {
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
      value: byHour[Math.floor(i / 12)] ?? 0,
      datetime: `${newY}-${newM}-${newD}T${newH}:${newMi}:00.000${offset}`,
    });
  }
  return out;
}

/** Construye los items REE esperados por `buildDemandCurve`. */
function makeItems(
  realByHour: Record<number, number>,
  prevByHour: Record<number, number>,
): DemandItemRaw[] {
  return [
    { type: 'Real', values: makeValues(realByHour) },
    { type: 'Prevista', values: makeValues(prevByHour) },
  ];
}

/** Hour 23 (last entry) value === currentMW para emular la poll en fin de día. */
const SAMPLE_REAL = {
  0: 24800,
  2: 22100,
  20: 33200,
  23: 33200,
};
const SAMPLE_PREV = {
  0: 25200,
  2: 22600,
  20: 32700,
  23: 32700,
};

describe('LiveDemandService', () => {
  let service: LiveDemandService;
  let reeClient: {
    fetchDemandaTiempoReal: ReturnType<typeof vi.fn>;
    fetchGenerationMix: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    reeClient = {
      fetchDemandaTiempoReal: vi.fn(),
      fetchGenerationMix: vi.fn(),
    };

    // Constructor guard para que ReeClientService no falle en
    // instancia (boot pre-flight §3.18). §3.37 restaura LIVE_API.
    process.env.REE_API_URL = 'http://test.example/energy';
    process.env.REE_FRONTERAS_API_URL = 'http://test.example/fronteras';
    process.env.REE_LIVE_API_URL = 'http://test.example/live';

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        LiveDemandService,
        { provide: ReeClientService, useValue: reeClient },
        // Mock del modelo Mongoose live: `findOne().sort().lean().exec()` +
        // `findOneAndUpdate`.
        {
          provide: getModelToken(LiveDemand.name),
          useValue: {
            findOne: vi.fn().mockReturnValue({
              sort: vi.fn().mockReturnValue({
                lean: vi.fn().mockReturnValue({
                  exec: vi.fn().mockResolvedValue(null),
                }),
              }),
            }),
            findOneAndUpdate: vi.fn().mockResolvedValue({}),
          },
        },
        // §3.38 — mock del modelo histórico. Composite unique key
        // (region, date). `findOne()` directo (sin `.sort()` porque la
        // composite unique key garantiza exactamente 1 doc por key).
        // Por default `exec` retorna null → cache miss exercised.
        {
          provide: getModelToken(LiveDemandHistorical.name),
          useValue: {
            findOne: vi.fn().mockReturnValue({
              lean: vi.fn().mockReturnValue({
                exec: vi.fn().mockResolvedValue(null),
              }),
            }),
            findOneAndUpdate: vi.fn().mockResolvedValue({}),
          },
        },
      ],
    }).compile();

    service = moduleRef.get<LiveDemandService>(LiveDemandService);
  });

  describe('cache miss (fresh service)', () => {
    it('fetches demanda-tiempo-real + generation-mix in parallel and persists via findOneAndUpdate', async () => {
      reeClient.fetchDemandaTiempoReal.mockResolvedValue(
        makeItems(SAMPLE_REAL, SAMPLE_PREV),
      );
      reeClient.fetchGenerationMix.mockResolvedValue({
        renewablePercentageValue: 47.3,
      });

      const result = await service.getSnapshot();

      // Las 2 llamadas a REE pasaron (refactor §3.37: ya no son 3).
      expect(reeClient.fetchDemandaTiempoReal).toHaveBeenCalledTimes(1);
      expect(reeClient.fetchGenerationMix).toHaveBeenCalledTimes(1);

      // El upsert se ejecutó con el snapshot.
      const upsert = (service as any).liveModel;
      expect(upsert.findOneAndUpdate).toHaveBeenCalledTimes(1);

      // currentMW = último entry de Real.values (hour 23, minute 55 →
      // toma hour 23 que es el último bucket en aggregateHourly).
      expect(result.currentDemandMW).toBe(33200);
      // maxForecastMW = max(prevista) = max de SAMPLE_PREV = 32700.
      expect(result.maxForecastMW).toBe(32700);
      // minTodayMW = min(real > 0) initial=currentMW=33200 →
      //   h0=24800 < 33200 → acc=24800
      //   h2=22100 < 24800 → acc=22100
      //   h20=33200 → sin cambio
      //   h23=33200 → sin cambio
      // Final: 22100.
      expect(result.minTodayMW).toBe(22100);
      expect(result.renewablePercentageValue).toBe(47.3);
      // curve: 24 entries, hour 0 con {00h, real=24800, prevista=25200}.
      expect(result.demandCurve).toHaveLength(24);
      expect(result.demandCurve[0]).toEqual({
        h: '00h',
        real: 24800,
        prevista: 25200,
      });
      expect(result.demandCurve[23]).toEqual({
        h: '23h',
        real: 33200,
        prevista: 32700,
      });
      expect(result.timestamp).toBeInstanceOf(Date);
      // §3.41 — region en el snapshot debe ser el enum value 'NACIONAL'
      // (no kebab-Display). Lockin explícito de la nueva convención
      // para evitar regresión al bug §3.40 (GraphQL enum serialization
      // failure "cannot represent value: 'Nacional'").
      expect(result.region).toBe('NACIONAL');
    });

    it('uses the current demand value as fallback when curve has no real>0 points', async () => {
      // Real con 0s (excepto hour 23 = currentMW para mantener el sentinel).
      // Prevista también 0s. Resultado: min(real>0 sobre 24 entries) == 0
      // → fallback del reduce al initial=currentMW=15000.
      reeClient.fetchDemandaTiempoReal.mockResolvedValue(
        makeItems({ 23: 15000 }, { 23: 14000 }),
      );
      reeClient.fetchGenerationMix.mockResolvedValue({
        renewablePercentageValue: 30,
      });

      const result = await service.getSnapshot();
      expect(result.currentDemandMW).toBe(15000);
      expect(result.minTodayMW).toBe(15000); // fallback al currentMW
    });
  });

  describe('cache hit', () => {
    it('returns the cached snapshot without calling REE', async () => {
      const cached = {
        _id: 'mock-id',
        timestamp: new Date('2025-04-20T20:00:00Z'),
        currentDemandMW: 33200,
        maxForecastMW: 32700,
        minTodayMW: 20450,
        renewablePercentageValue: 47.3,
        curve: [
          { h: '00h', real: 24800, prevista: 25200 },
          { h: '02h', real: 22100, prevista: 22600 },
          { h: '20h', real: 33200, prevista: 32700 },
        ],
        region: 'NACIONAL', // §3.41 enum value (was 'Nacional' kebab-Display pre-§3.41)
        createdAt: new Date(Date.now() - 30_000), // 30s ago → fresh
      };
      (service as any).liveModel.findOne = vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({
          lean: vi.fn().mockReturnValue({
            exec: vi.fn().mockResolvedValue(cached),
          }),
        }),
      });

      const result = await service.getSnapshot();

      expect(reeClient.fetchDemandaTiempoReal).toHaveBeenCalledTimes(0);
      expect(reeClient.fetchGenerationMix).toHaveBeenCalledTimes(0);

      expect(result.currentDemandMW).toBe(33200);
      expect(result.maxForecastMW).toBe(32700);
      // SAMPLE_CURVE del cache hit = 3 entries — el shape() devuelve
      // el cached.curve verbatim.
      expect(result.demandCurve).toHaveLength(3);
      // §3.41 — region en el cached doc debe ser 'NACIONAL' (enum value).
      expect(result.region).toBe('NACIONAL');
    });
  });

  describe('resilience (partial REE failure — allSettled semantics)', () => {
    /**
     * §3.27 contract + §3.37 refactor:
     *   - Pre-fix (pre-§3.27): Promise.all corto-circuitaba → throw.
     *   - Post-§3.27: Promise.allSettled degrada a defaults por fetch
     *     fallido + WARN por cada uno. Frontend no entra en error-loop.
     *   - §3.37: ahora la rama es fetchDemandaTiempoReal + fetchGenerationMix
     *     (en lugar de los 3 métodos legacy). La semántica del degrade
     *     es la MISMA — fail loud para el caller del resolver pero la
     *     snapshot se entrega igual con datos parciales.
     */
    it('returns partial snapshot with safe defaults when only demanda-tiempo-real fails', async () => {
      // Solo demanda-tiempo-real rechaza — mix funciona.
      // Esperado: currentMW=0, curve=[], renewable%=... mix real.
      reeClient.fetchDemandaTiempoReal.mockRejectedValue(
        new Error('ree-demanda-down'),
      );
      reeClient.fetchGenerationMix.mockResolvedValue({
        renewablePercentageValue: 47.3,
      });

      const result = await service.getSnapshot();

      expect(result.currentDemandMW).toBe(0);
      expect(result.renewablePercentageValue).toBe(47.3);
      expect(result.maxForecastMW).toBe(0);
      expect(result.minTodayMW).toBe(0);
      expect(result.demandCurve).toEqual([]);
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('returns all-zero snapshot when all 2 fetches fail (snapshot degraded, not crashed)', async () => {
      // Las 2 sub-rutas REE rechazan (escenario cuando LIVE_API_URL
      // es incorrecta y devuelve 404). El snapshot NO debe tirar; debe
      // entregarse con defaults seguros.
      const down = new Error('ree-all-down');
      reeClient.fetchDemandaTiempoReal.mockRejectedValue(down);
      reeClient.fetchGenerationMix.mockRejectedValue(down);

      const result = await service.getSnapshot();

      expect(result.currentDemandMW).toBe(0);
      expect(result.maxForecastMW).toBe(0);
      expect(result.minTodayMW).toBe(0);
      expect(result.renewablePercentageValue).toBe(0);
      expect(result.demandCurve).toEqual([]);
      expect(result.timestamp).toBeInstanceOf(Date);
    });
  });

  describe('integration: getHistoricalHourlySnapshot (§3.37 NEW)', () => {
    /**
     * Cubre el flujo end-to-end de la curva histórica:
     *   1. Service llama `reeClient.fetchDemandaTiempoReal(geoLimit?)`
     *      con el rango correspondiente (ver §3.37 — internalmente usa
     *      today para live; service pasa "" cuando el caller no
     *      especifica geoLimit).
     *   2. Recibe `[{type, values[]}]` con 288 entries 5-min por serie.
     *   3. `buildDemandCurve(items)` zipea Real + Prevista a 24 puntos
     *      `{h, real, prevista}`.
     *   4. KPIs computados: currentMW = última entry.real, max/min
     *      sobre la curva.
     *
     * Mock: captura el método del ree-client (mismo shape que en cache
     * miss tests). El servicio NO toca cache mongo para historical —
     * siempre va a REE (TODO §6 reintroducir el cache TTL 24h).
     */
    it('builds 24-point curve from demanda-tiempo-real response + computes KPIs', async () => {
      reeClient.fetchDemandaTiempoReal.mockResolvedValue(
        makeItems(SAMPLE_REAL, SAMPLE_PREV),
      );

      const result = await service.getHistoricalHourlySnapshot(
        '2026-07-14',
        undefined,
      );

      // REE llamado exactamente 1 vez (cache is by design disabled).
      expect(reeClient.fetchDemandaTiempoReal).toHaveBeenCalledTimes(1);
      // Y — CRÍTICO §3.37 review CONCERN #4 — la fecha histórica
      // llega como Date argumento al ree-client. Sin esta aserción,
      // un bug como "ignora el `date` arg y consulta hoy" pasaría el
      // test silenciosamente.
      const callArgs = reeClient.fetchDemandaTiempoReal.mock.calls[0];
      expect(callArgs.length).toBeGreaterThanOrEqual(2);
      expect(callArgs[1]).toBeInstanceOf(Date);
      // El día local parseado del input '2026-07-14' debe matchear.
      expect((callArgs[1] as Date).getFullYear()).toBe(2026);
      expect((callArgs[1] as Date).getMonth()).toBe(6); // 0-indexed julio
      expect((callArgs[1] as Date).getDate()).toBe(14);
      // currentMW = último entry.real (hour 23 bucket) = 33200.
      expect(result.currentDemandMW).toBe(33200);
      // max/min sobre la curva del día.
      expect(result.maxForecastMW).toBe(32700);
      expect(result.minTodayMW).toBe(22100);
      // renewablePercentageValue = 0 (historical nunca expone mix).
      expect(result.renewablePercentageValue).toBe(0);
      // demandCurve: exactamente 24 puntos con h, real, prevista coherentes.
      expect(result.demandCurve).toHaveLength(24);
      expect(result.demandCurve[0]).toEqual({
        h: '00h',
        real: 24800,
        prevista: 25200,
      });
      expect(result.demandCurve[23]).toEqual({
        h: '23h',
        real: 33200,
        prevista: 32700,
      });
      // El timestamp es la fecha histórica pedida (no now).
      expect(result.timestamp).toEqual(new Date('2026-07-14T00:00:00'));
      // §3.41 — regionCacheKey retorna enum value (uppercase) para
      // que GraphQL enum serialization funcione end-to-end. Cache key
      // y snapshot.region son ambos 'NACIONAL' (no kebab-Display).
      expect(result.region).toBe('NACIONAL');
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // §3.38 — Cache-aside v1 del historical snapshot
  // Composite key (region, date), TTL 24h. 4 specs nuevos:
  //   - H1: cache hit → 0 fetch REE
  //   - H2: cache miss → 1 fetch + atomic upsert con composite key
  //   - H3: fetch error → no save + error propagates (no negative cache)
  //   - H4: integration con region específico distinto de 'Nacional'
  // ───────────────────────────────────────────────────────────────────────

  describe('historical cache (§3.38 cache-aside v1)', () => {
    it('H1: cache hit returns snapshot from Mongo without calling REE', async () => {
      // Pre-seede cache con un doc válido. El servicio NO debe
      // llamar REE — debe devolver el shape desde el doc cacheado.
      const cachedDoc = {
        _id: 'cached-id',
        timestamp: new Date('2026-07-14T00:00:00'),
        currentDemandMW: 28000,
        maxForecastMW: 29500,
        minTodayMW: 18000,
        renewablePercentageValue: 0,
        curve: [
          { h: '00h', real: 20000, prevista: 21000 },
          { h: '12h', real: 28000, prevista: 29500 },
          { h: '23h', real: 25000, prevista: 26000 },
        ],
        region: 'NACIONAL', // §3.41 enum value (was 'Nacional' kebab-Display pre-§3.41)
        createdAt: new Date(Date.now() - 60_000), // 1min ago
      };
      (service as any).historicalModel.findOne = vi.fn().mockReturnValue({
        lean: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue(cachedDoc),
        }),
      });

      const result = await service.getHistoricalHourlySnapshot(
        '2026-07-14',
        undefined,
      );

      // Cero fetch a REE.
      expect(reeClient.fetchDemandaTiempoReal).toHaveBeenCalledTimes(0);
      // Cero upserts (cache hit, no save needed).
      const historicalModel = (service as any).historicalModel;
      expect(historicalModel.findOneAndUpdate).toHaveBeenCalledTimes(0);
      // Shape devuelto desde el cache.
      expect(result.currentDemandMW).toBe(28000);
      expect(result.maxForecastMW).toBe(29500);
      expect(result.demandCurve).toHaveLength(3);
      expect(result.region).toBe('NACIONAL');
      // findOne llamado con composite key (region: 'NACIONAL', date: '2026-07-14').
      expect(historicalModel.findOne).toHaveBeenCalledWith({
        region: 'NACIONAL',
        date: '2026-07-14',
      });
    });

    it('H2: cache miss fetches REE + persists via findOneAndUpdate with composite key', async () => {
      // Default mocks en beforeEach devuelven null (cache miss) +
      // fetchDemandaTiempoReal resuelve con items mock.
      reeClient.fetchDemandaTiempoReal.mockResolvedValue(
        makeItems(SAMPLE_REAL, SAMPLE_PREV),
      );

      await service.getHistoricalHourlySnapshot('2026-07-14', undefined);

      // 1 fetch a REE.
      expect(reeClient.fetchDemandaTiempoReal).toHaveBeenCalledTimes(1);
      // 1 upsert con composite key (region, date).
      const historicalModel = (service as any).historicalModel;
      expect(historicalModel.findOneAndUpdate).toHaveBeenCalledTimes(1);

      // Args del upsert: composite key match + $set con el snapshot.
      const [filterArg, setArg, optionsArg] =
        historicalModel.findOneAndUpdate.mock.calls[0];
      expect(filterArg).toEqual({ region: 'NACIONAL', date: '2026-07-14' });
      expect(setArg.$set.region).toBe('NACIONAL');
      expect(setArg.$set.date).toBe('2026-07-14');
      expect(setArg.$set.curve).toHaveLength(24);
      expect(optionsArg).toEqual({ upsert: true, new: true });
    });

    it('H3: fetch error propagates as InternalServerErrorException with no cache save (no negative cache)', async () => {
      // Cache miss (findOne → null) + fetch rejects → service tier
      // translates to InternalServerErrorException. NO se llama
      // findOneAndUpdate (negative cache desactivada por contrato).
      reeClient.fetchDemandaTiempoReal.mockRejectedValue(
        new Error('ree-historical-down'),
      );

      await expect(
        service.getHistoricalHourlySnapshot('2026-07-14', undefined),
      ).rejects.toMatchObject({
        message: expect.stringContaining('ree-historical-down'),
      });

      const historicalModel = (service as any).historicalModel;
      expect(historicalModel.findOneAndUpdate).toHaveBeenCalledTimes(0);
    });

    it('H4: integration with specific region uses composite key (region + date)', async () => {
      // §3.41 — region='PENINSULAR' (enum value) → cacheKey='PENINSULAR'
      // (enum value) → persist key '{region: "PENINSULAR", date: "..."}'
      // en Mongo + snapshot.region='PENINSULAR' (que GraphQL serializa OK).
      reeClient.fetchDemandaTiempoReal.mockResolvedValue(
        makeItems(SAMPLE_REAL, SAMPLE_PREV),
      );

      const result = await service.getHistoricalHourlySnapshot(
        '2026-07-14',
        'PENINSULAR' as LiveDemandRegionSlug,
      );

      // 1 fetch con geoLimit='peninsular' (regionToGeoLowercase).
      expect(reeClient.fetchDemandaTiempoReal).toHaveBeenCalledTimes(1);
      const callArgs = reeClient.fetchDemandaTiempoReal.mock.calls[0];
      // geoLimit (1er arg) = 'peninsular' (kebab-case lowercase).
      expect(callArgs[0]).toBe('peninsular');
      // §3.41 — Snap devuelto tiene region='PENINSULAR' (enum value,
      // no kebab-Display). Si dejara 'Peninsular' aquí, GraphQL enum
      // serialization del response fallaría con cannot represent value.
      expect(result.region).toBe('PENINSULAR');
      // Snapshot persistido bajo composite key (region: 'PENINSULAR',
      // date: '2026-07-14') — no cross-pollination con Nacional.
      const historicalModel = (service as any).historicalModel;
      const [filterArg] = historicalModel.findOneAndUpdate.mock.calls[0];
      expect(filterArg).toEqual({
        region: 'PENINSULAR',
        date: '2026-07-14',
      });
    });
  });
});
