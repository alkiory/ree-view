import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LiveDemandService } from '../live-demand.service';
import { ReeClientService } from '../ree-client.service';
import { LiveDemand } from '../../schemas/live-demand.schema';

/**
 * Cobertura de la lógica cache-aside:
 *   - Cache hit (documento existente con TTL vigente) → 0 fetch a
 *     `ReeClientService`, devuelve el shape desde Mongo.
 *   - Cache miss (no hay documento o expiró) → 3 fetches a REE en
 *     paralelo, upsert vía `findOneAndUpdate`, devuelve el shape.
 *
 * El Resolver expone sólo un query sin input — la validación no es
 * relevante aquí (ver `live-demand.resolver.ts`).
 */
describe('LiveDemandService', () => {
  let service: LiveDemandService;
  let reeClient: {
    fetchCurrentDemand: ReturnType<typeof vi.fn>;
    fetchDailyDemandCurve: ReturnType<typeof vi.fn>;
    fetchGenerationMix: ReturnType<typeof vi.fn>;
  };

  const SAMPLE_CURVE = [
    { h: '00h', real: 24800, prevista: 25200 },
    { h: '02h', real: 22100, prevista: 22600 },
    { h: '20h', real: 33200, prevista: 32700 },
  ];

  const buildLeanDoc = (overrides: Record<string, unknown> = {}) => ({
    _id: 'mock-id',
    timestamp: new Date('2025-04-20T20:00:00Z'),
    currentDemandMW: 33200,
    maxForecastMW: 32700,
    minTodayMW: 20450,
    renewablePercentageValue: 47.3,
    curve: SAMPLE_CURVE,
    createdAt: new Date(Date.now() - 30_000), // 30s ago → fresh
    ...overrides,
  });

  beforeEach(async () => {
    reeClient = {
      fetchCurrentDemand: vi.fn(),
      fetchDailyDemandCurve: vi.fn(),
      fetchGenerationMix: vi.fn(),
    };

    // Constructor guard para que ReeClientService no falle en
    // instancia (boot pre-flight §3.18 CURRENT.md).
    process.env.REE_API_URL = 'http://test.example/energy';
    process.env.REE_FRONTERAS_API_URL = 'http://test.example/fronteras';
    process.env.REE_LIVE_API_URL = 'http://test.example/live';

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        LiveDemandService,
        { provide: ReeClientService, useValue: reeClient },
        // Mock del modelo Mongoose: `findOne().sort().lean().exec()` +
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
      ],
    }).compile();

    service = moduleRef.get<LiveDemandService>(LiveDemandService);
  });

  describe('cache miss (fresh service)', () => {
    it('fetches 3 REE endpoints in parallel and persists via findOneAndUpdate', async () => {
      reeClient.fetchCurrentDemand.mockResolvedValue(33200);
      reeClient.fetchDailyDemandCurve.mockResolvedValue(SAMPLE_CURVE);
      reeClient.fetchGenerationMix.mockResolvedValue({
        renewablePercentageValue: 47.3,
      });

      const result = await service.getSnapshot();

      // Las 3 llamadas a REE pasaron.
      expect(reeClient.fetchCurrentDemand).toHaveBeenCalledTimes(1);
      expect(reeClient.fetchDailyDemandCurve).toHaveBeenCalledTimes(1);
      expect(reeClient.fetchGenerationMix).toHaveBeenCalledTimes(1);

      // El upsert se ejecutó con el snapshot.
      const upsert = (service as any).liveModel;
      expect(upsert.findOneAndUpdate).toHaveBeenCalledTimes(1);

      // Shape correcto: maxForecastMW = max(prevista); minTodayMW
      // = min(real > 0); renewablePercentageValue propagada.
      expect(result.currentDemandMW).toBe(33200);
      expect(result.maxForecastMW).toBe(32700);
      // SAMPLE_CURVE = [{00h, 24800}, {02h, 22100}, {20h, 33200}].
      // Min real>0 de los `real>0` = 22100.
      expect(result.minTodayMW).toBe(22100);
      expect(result.renewablePercentageValue).toBe(47.3);
      expect(result.demandCurve).toEqual(SAMPLE_CURVE);
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('uses the current demand value as fallback when curve has no real>0 points', async () => {
      // Curva vacía o con `real=0` → fallback a `currentMW` para
      // `minTodayMW` (evita `Math.min(∞, 0) === 0`).
      reeClient.fetchCurrentDemand.mockResolvedValue(15000);
      reeClient.fetchDailyDemandCurve.mockResolvedValue([
        { h: '01h', real: 0, prevista: 14000 },
      ]);
      reeClient.fetchGenerationMix.mockResolvedValue({
        renewablePercentageValue: 30,
      });

      const result = await service.getSnapshot();
      expect(result.minTodayMW).toBe(15000); // fallback al currentMW
    });
  });

  describe('cache hit', () => {
    it('returns the cached snapshot without calling REE', async () => {
      const cached = buildLeanDoc();
      (service as any).liveModel.findOne = vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({
          lean: vi.fn().mockReturnValue({
            exec: vi.fn().mockResolvedValue(cached),
          }),
        }),
      });

      const result = await service.getSnapshot();

      expect(reeClient.fetchCurrentDemand).toHaveBeenCalledTimes(0);
      expect(reeClient.fetchDailyDemandCurve).toHaveBeenCalledTimes(0);
      expect(reeClient.fetchGenerationMix).toHaveBeenCalledTimes(0);

      expect(result.currentDemandMW).toBe(33200);
      expect(result.maxForecastMW).toBe(32700);
      expect(result.demandCurve).toEqual(SAMPLE_CURVE);
    });
  });

  describe('resilience (partial REE failure — allSettled semantics)', () => {
    /**
     * Cambio de contrato (CURRENT §6 #17):
     *   - Pre-fix: `Promise.all` corto-circuitaba ante la primera
     *     falla → `getSnapshot()` lanzaba `InternalServerErrorException`
     *     con el `cause` del error original.
     *   - Post-fix: `Promise.allSettled` degrada a defaults por
     *     fetch fallido y registra un WARN por cada uno. El snapshot
     *     se construye igual con datos parciales — esto es MEJOR que
     *     nada porque libera al frontend del error-loop 60s.
     *
     * Los tests cubren los 2 escenarios motívales:
     */
    it('returns partial snapshot with safe defaults when only current-demand fails', async () => {
      // Solo `current-demand` rechaza — los demás endpoints funcionan.
      // Esperado: currentDemandMW=0 (default), curve y mix se computan
      // con los valores reales, snapshot se entrega sin throw.
      reeClient.fetchCurrentDemand.mockRejectedValue(
        new Error('ree-current-demand-down'),
      );
      reeClient.fetchDailyDemandCurve.mockResolvedValue(SAMPLE_CURVE);
      reeClient.fetchGenerationMix.mockResolvedValue({
        renewablePercentageValue: 47.3,
      });

      const result = await service.getSnapshot();

      // Falla de current-demand → default 0.
      expect(result.currentDemandMW).toBe(0);
      // Mix exitoso → valor real propagado.
      expect(result.renewablePercentageValue).toBe(47.3);
      // Curve exitoso → max/min computados (min respeta initial=`currentMW`=0).
      // SAMPLE_CURVE.real = [24800, 22100, 33200]; min over `real>0`
      // con `acc=0` initial es siempre 0. Eso es la firma del degradation:
      // cuando el current falló, min no es confiable → mostra 0.
      expect(result.maxForecastMW).toBe(32700);
      expect(result.minTodayMW).toBe(0);
      expect(result.demandCurve).toEqual(SAMPLE_CURVE);
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('returns all-zero snapshot when all 3 fetches fail (snapshot degraded, not crashed)', async () => {
      // Los 3 endpoints rechazan (escenario cuando REE_LIVE_API_URL
      // URLs son incorrectas y todas dan 404). El snapshot NO debe
      // tirar; debe entregarse con defaults seguros.
      const down = new Error('ree-all-down');
      reeClient.fetchCurrentDemand.mockRejectedValue(down);
      reeClient.fetchDailyDemandCurve.mockRejectedValue(down);
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
});
