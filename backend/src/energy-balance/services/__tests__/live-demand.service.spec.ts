import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LiveDemandService } from '../live-demand.service';
import { ReeClientService } from '../ree-client.service';
import { LiveDemand } from '../../schemas/live-demand.schema';
import { LiveDemandHistorical } from '../../schemas/live-demand-historical.schema';
import type { DemandItemRaw } from '../../util/aggregate-hourly';

const BASE_ISO = '2026-07-14T00:00:00.000+02:00';

/**
 * Genera el array de 288 valores 5-min con TZ-safe string-only parser
 * (no `new Date()` para evitar conversión a TZ del runner).
 */
function makeValues(
  byHour: Record<number, number>,
): { value: number; datetime: string }[] {
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

function makeItems(
  realByHour: Record<number, number>,
  prevByHour: Record<number, number>,
): DemandItemRaw[] {
  return [
    { type: 'Real', values: makeValues(realByHour) },
    { type: 'Prevista', values: makeValues(prevByHour) },
  ];
}

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

    process.env.REE_API_URL = 'http://test.example/energy';
    process.env.REE_FRONTERAS_API_URL = 'http://test.example/fronteras';
    process.env.REE_LIVE_API_URL = 'http://test.example/live';

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        LiveDemandService,
        { provide: ReeClientService, useValue: reeClient },
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

      expect(reeClient.fetchDemandaTiempoReal).toHaveBeenCalledTimes(1);
      expect(reeClient.fetchGenerationMix).toHaveBeenCalledTimes(1);

      const upsert = (service as any).liveModel;
      expect(upsert.findOneAndUpdate).toHaveBeenCalledTimes(1);

      expect(result.currentDemandMW).toBe(33200);
      expect(result.maxForecastMW).toBe(32700);
      expect(result.minTodayMW).toBe(22100);
      expect(result.renewablePercentageValue).toBe(47.3);
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
      expect(result.region).toBe('NACIONAL');
    });

    it('uses the current demand value as fallback when curve has no real>0 points', async () => {
      reeClient.fetchDemandaTiempoReal.mockResolvedValue(
        makeItems({ 23: 15000 }, { 23: 14000 }),
      );
      reeClient.fetchGenerationMix.mockResolvedValue({
        renewablePercentageValue: 30,
      });

      const result = await service.getSnapshot();
      expect(result.currentDemandMW).toBe(15000);
      expect(result.minTodayMW).toBe(15000);
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
        region: 'NACIONAL',
        createdAt: new Date(Date.now() - 30_000),
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
      expect(result.demandCurve).toHaveLength(3);
      expect(result.region).toBe('NACIONAL');
    });
  });

  describe('resilience (partial REE failure — allSettled semantics)', () => {
    it('returns partial snapshot with safe defaults when only demanda-tiempo-real fails', async () => {
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

  describe('integration: getHistoricalHourlySnapshot', () => {
    it('builds 24-point curve from demanda-tiempo-real response + computes KPIs', async () => {
      reeClient.fetchDemandaTiempoReal.mockResolvedValue(
        makeItems(SAMPLE_REAL, SAMPLE_PREV),
      );

      const result = await service.getHistoricalHourlySnapshot(
        '2026-07-14',
        undefined,
      );

      expect(reeClient.fetchDemandaTiempoReal).toHaveBeenCalledTimes(1);
      const callArgs = reeClient.fetchDemandaTiempoReal.mock.calls[0];
      expect(callArgs.length).toBeGreaterThanOrEqual(2);
      expect(callArgs[1]).toBeInstanceOf(Date);
      expect((callArgs[1] as Date).getFullYear()).toBe(2026);
      expect((callArgs[1] as Date).getMonth()).toBe(6);
      expect((callArgs[1] as Date).getDate()).toBe(14);
      expect(result.currentDemandMW).toBe(33200);
      expect(result.maxForecastMW).toBe(32700);
      expect(result.minTodayMW).toBe(22100);
      expect(result.renewablePercentageValue).toBe(0);
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
      expect(result.timestamp).toEqual(new Date('2026-07-14T00:00:00'));
      expect(result.region).toBe('NACIONAL');
    });
  });

  describe('historical cache (cache-aside v1)', () => {
    it('H1: cache hit returns snapshot from Mongo without calling REE', async () => {
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
        region: 'NACIONAL',
        createdAt: new Date(Date.now() - 60_000),
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

      expect(reeClient.fetchDemandaTiempoReal).toHaveBeenCalledTimes(0);
      const historicalModel = (service as any).historicalModel;
      expect(historicalModel.findOneAndUpdate).toHaveBeenCalledTimes(0);
      expect(result.currentDemandMW).toBe(28000);
      expect(result.maxForecastMW).toBe(29500);
      expect(result.demandCurve).toHaveLength(3);
      expect(result.region).toBe('NACIONAL');
      expect(historicalModel.findOne).toHaveBeenCalledWith({
        region: 'NACIONAL',
        date: '2026-07-14',
      });
    });

    it('H2: cache miss fetches REE + persists via findOneAndUpdate with composite key', async () => {
      reeClient.fetchDemandaTiempoReal.mockResolvedValue(
        makeItems(SAMPLE_REAL, SAMPLE_PREV),
      );

      await service.getHistoricalHourlySnapshot('2026-07-14', undefined);

      expect(reeClient.fetchDemandaTiempoReal).toHaveBeenCalledTimes(1);
      const historicalModel = (service as any).historicalModel;
      expect(historicalModel.findOneAndUpdate).toHaveBeenCalledTimes(1);

      const [filterArg, setArg, optionsArg] =
        historicalModel.findOneAndUpdate.mock.calls[0];
      expect(filterArg).toEqual({ region: 'NACIONAL', date: '2026-07-14' });
      expect(setArg.$set.region).toBe('NACIONAL');
      expect(setArg.$set.date).toBe('2026-07-14');
      expect(setArg.$set.curve).toHaveLength(24);
      expect(optionsArg).toEqual({ upsert: true, new: true });
    });

    it('H3: fetch error propagates as InternalServerErrorException with no cache save (no negative cache)', async () => {
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
      reeClient.fetchDemandaTiempoReal.mockResolvedValue(
        makeItems(SAMPLE_REAL, SAMPLE_PREV),
      );

      const result = await service.getHistoricalHourlySnapshot(
        '2026-07-14',
        'PENINSULAR' as any,
      );

      expect(reeClient.fetchDemandaTiempoReal).toHaveBeenCalledTimes(1);
      const callArgs = reeClient.fetchDemandaTiempoReal.mock.calls[0];
      expect(callArgs[0]).toBe('peninsular');
      expect(result.region).toBe('PENINSULAR');
      const historicalModel = (service as any).historicalModel;
      const [filterArg] = historicalModel.findOneAndUpdate.mock.calls[0];
      expect(filterArg).toEqual({
        region: 'PENINSULAR',
        date: '2026-07-14',
      });
    });
  });
});
