import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { InternalServerErrorException } from '@nestjs/common';
import { AxiosError, AxiosResponse } from 'axios';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReeClientService } from '../ree-client.service';

const MOCK_INCLUDED = [
  {
    id: 'g1',
    attributes: {
      content: [
        { id: 'i1', type: 'Hidráulica', groupId: 'Renovable', attributes: {} },
        { id: 'i2', type: 'Eólica', groupId: 'Renovable', attributes: {} },
      ],
    },
  },
  {
    id: 'g2',
    attributes: {
      content: [
        { id: 'i3', type: 'Nuclear', groupId: 'No-Renovable', attributes: {} },
      ],
    },
  },
];

describe('ReeClientService', () => {
  let service: ReeClientService;
  let httpGet: ReturnType<typeof vi.fn>;

  // Fechas construidas con `new Date(yyyy, mm, dd, ...)` (LOCAL
  // midnight) en lugar de `.000Z` (UTC midnight) para que el test
  // sea estable cross-TZ con `formatDate` (getters locales).
  const start = new Date(2025, 3, 20, 0, 0, 0);
  const end = new Date(2025, 3, 20, 23, 59, 59);

  const createAxiosResponse = <T>(data: T): AxiosResponse<T> => ({
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config: {} as AxiosResponse<T>['config'],
  });

  beforeEach(async () => {
    httpGet = vi.fn();

    process.env.REE_API_URL = 'http://test.example/energy';
    process.env.REE_FRONTERAS_API_URL = 'http://test.example/fronteras';
    process.env.REE_LIVE_API_URL = 'http://test.example/live';

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ReeClientService,
        {
          provide: HttpService,
          useValue: { get: httpGet },
        },
      ],
    }).compile();

    service = moduleRef.get<ReeClientService>(ReeClientService);
  });

  afterEach(() => {
    delete process.env.REE_API_URL;
    delete process.env.REE_FRONTERAS_API_URL;
    delete process.env.REE_LIVE_API_URL;
    delete process.env.REE_API_URL_ERROR;
    vi.clearAllMocks();
  });

  describe('constructor guard (boot pre-flight)', () => {
    it('throws actionable error when REE_API_URL and REE_API_URL_ERROR are missing', async () => {
      delete process.env.REE_API_URL;
      delete process.env.REE_API_URL_ERROR;
      await expect(
        Test.createTestingModule({
          providers: [
            ReeClientService,
            { provide: HttpService, useValue: { get: vi.fn() } },
          ],
        }).compile(),
      ).rejects.toThrow(
        /REE_API_URL no configurado\. Crea backend\/\.env desde backend\/\.env\.example/,
      );
    });

    it('throws actionable error when REE_FRONTERAS_API_URL and REE_API_URL_ERROR are missing', async () => {
      process.env.REE_API_URL = 'http://test.example/energy';
      delete process.env.REE_FRONTERAS_API_URL;
      delete process.env.REE_API_URL_ERROR;
      await expect(
        Test.createTestingModule({
          providers: [
            ReeClientService,
            { provide: HttpService, useValue: { get: vi.fn() } },
          ],
        }).compile(),
      ).rejects.toThrow(
        /REE_FRONTERAS_API_URL no configurado\. Crea backend\/\.env desde backend\/\.env\.example/,
      );
    });
  });

  describe('fetchData', () => {
    it('flattens and maps the included array into domain rows', async () => {
      httpGet.mockReturnValue(
        of(createAxiosResponse({ included: MOCK_INCLUDED })),
      );

      const result = await service.fetchData({ start, end });

      expect(httpGet).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(3);
      expect(result[0]).toMatchObject({
        startDate: start,
        endDate: end,
        type: 'Hidráulica',
        groupId: 'Renovable',
      });
    });

    it('passes correctly formatted REE params', async () => {
      httpGet.mockReturnValue(of(createAxiosResponse({ included: [] })));

      await service.fetchData({ start, end });

      const [, config] = httpGet.mock.calls[0];
      expect(config.params.start_date).toBe('2025-04-20 00:00');
      expect(config.params.end_date).toMatch(/2025-04-20 23:59/);
      expect(config.params.time_trunc).toBe('day');
      expect(config.params.cached).toBe('true');
    });

    it('throws InternalServerErrorException when response is missing "included"', async () => {
      httpGet.mockReturnValue(of(createAxiosResponse({ notIncluded: true })));

      await expect(service.fetchData({ start, end })).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
    });

    it('skips groups with malformed content and returns the valid ones', async () => {
      httpGet.mockReturnValue(
        of(
          createAxiosResponse({
            included: [
              { id: 'broken', attributes: { content: 'not-an-array' } },
              {
                id: 'ok',
                attributes: {
                  content: [
                    {
                      id: 'i1',
                      type: 'Solar',
                      groupId: 'Renovable',
                      attributes: {},
                    },
                  ],
                },
              },
            ],
          }),
        ),
      );

      const result = await service.fetchData({ start, end });
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Solar');
    });

    it('throws InternalServerErrorException with API detail on AxiosError', async () => {
      const axiosError = new AxiosError(
        'Server Error',
        '500',
        undefined,
        undefined,
        {
          data: {
            errors: [
              {
                title: 'REE 500',
                detail: 'ree-flow-down',
                code: 'E500',
                status: '500',
              },
            ],
          },
          status: 500,
          statusText: 'Server Error',
          headers: {},
          config: {} as AxiosResponse['config'],
        },
      );
      httpGet.mockReturnValue(throwError(() => axiosError));

      await expect(service.fetchData({ start, end })).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
    });

    it('throws InternalServerErrorException on unexpected (non-Axios) errors', async () => {
      httpGet.mockReturnValue(throwError(() => new Error('boom')));

      await expect(service.fetchData({ start, end })).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
    });

    it('propagates the original error message in the thrown InternalServerErrorException (fetchData)', async () => {
      httpGet.mockReturnValue(throwError(() => new Error('ree-flow-down')));
      await expect(service.fetchData({ start, end })).rejects.toMatchObject({
        message: 'Failed to fetch energy data: ree-flow-down',
        cause: expect.objectContaining({ message: 'ree-flow-down' }),
      });
      expect(httpGet).toHaveBeenCalledTimes(1);
    });
  });

  describe('fetchFronteras', () => {
    it('returns the raw content array', async () => {
      const raw = [
        {
          id: 'f1',
          type: 'Importación',
          groupId: 'Portugal ES',
          attributes: {},
        },
        {
          id: 'f2',
          type: 'Exportación',
          groupId: 'Francia ES',
          attributes: {},
        },
      ];
      httpGet.mockReturnValue(
        of(
          createAxiosResponse({
            included: [{ id: 'g1', attributes: { content: raw } }],
          }),
        ),
      );

      const result = await service.fetchFronteras({ start, end });

      expect(result).toEqual(raw);
    });

    it('throws InternalServerErrorException on missing "included"', async () => {
      httpGet.mockReturnValue(of(createAxiosResponse({})));

      await expect(
        service.fetchFronteras({ start, end }),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });

    it('throws InternalServerErrorException on AxiosError', async () => {
      const axiosError = new AxiosError(
        'Network Error',
        'ERR_NETWORK',
        undefined,
        undefined,
        {
          data: { errors: [{ detail: 'down', code: 'E503', status: '503' }] },
          status: 503,
          statusText: 'Service Unavailable',
          headers: {},
          config: {} as AxiosResponse['config'],
        },
      );
      httpGet.mockReturnValue(throwError(() => axiosError));

      await expect(
        service.fetchFronteras({ start, end }),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });

    it('throws InternalServerErrorException on generic errors', async () => {
      httpGet.mockReturnValue(throwError(() => new Error('boom-2')));

      await expect(
        service.fetchFronteras({ start, end }),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });

    it('propagates the original error message in the thrown InternalServerErrorException (fetchFronteras)', async () => {
      httpGet.mockReturnValue(throwError(() => new Error('frontera-down')));
      await expect(
        service.fetchFronteras({ start, end }),
      ).rejects.toMatchObject({
        message: 'Failed to fetch energy data: frontera-down',
        cause: expect.objectContaining({ message: 'frontera-down' }),
      });
      expect(httpGet).toHaveBeenCalledTimes(1);
    });
  });

  describe('fetchDemandaTiempoReal', () => {
    const makeRealisticIncluded = () => ({
      data: { type: 'Demanda', id: 'dem15' },
      included: [
        {
          type: 'Real',
          id: 2037,
          attributes: {
            title: 'Real',
            values: Array.from({ length: 288 }, (_, i) => ({
              value: 30000 + Math.floor(i / 12) * 100,
              percentage: 0.25,
              datetime: `2026-07-14T${String(Math.floor(i / 12)).padStart(2, '0')}:${String((i % 12) * 5).padStart(2, '0')}:00.000+02:00`,
            })),
          },
        },
        {
          type: 'Prevista',
          id: 2052,
          attributes: {
            title: 'Prevista',
            values: Array.from({ length: 288 }, (_, i) => ({
              value: 30500 + Math.floor(i / 12) * 100,
              percentage: 0.26,
              datetime: `2026-07-14T${String(Math.floor(i / 12)).padStart(2, '0')}:${String((i % 12) * 5).padStart(2, '0')}:00.000+02:00`,
            })),
          },
        },
      ],
    });

    it('returns parsed items array with {type, values[]} shape for Real + Prevista', async () => {
      httpGet.mockReturnValue(
        of(createAxiosResponse(makeRealisticIncluded())),
      );

      const items = await service.fetchDemandaTiempoReal(undefined);

      expect(httpGet).toHaveBeenCalledTimes(1);
      const [calledUrl, calledConfig] = httpGet.mock.calls[0];
      expect(calledUrl).toBe('http://test.example/live/demanda/demanda-tiempo-real');
      expect(calledConfig.params.start_date).toMatch(/^\d{4}-\d{2}-\d{2}T00:00$/);
      expect(calledConfig.params.end_date).toMatch(/^\d{4}-\d{2}-\d{2}T23:59$/);
      expect(calledConfig.params.time_trunc).toBe('hour');
      expect(calledConfig.params.cached).toBe('true');

      expect(items).toHaveLength(2);
      expect(items[0].type).toBe('Real');
      expect(items[0].values).toHaveLength(288);
      expect(items[0].values[0]).toEqual({
        value: 30000,
        percentage: 0.25,
        datetime: '2026-07-14T00:00:00.000+02:00',
      });
      expect(items[1].type).toBe('Prevista');
      expect(items[1].values[0].value).toBe(30500);
    });

    it('passes geo_limit param when provided (sub-región != nacional)', async () => {
      httpGet.mockReturnValue(
        of(createAxiosResponse(makeRealisticIncluded())),
      );

      await service.fetchDemandaTiempoReal('peninsular');

      const [, calledConfig] = httpGet.mock.calls[0];
      expect(calledConfig.params.geo_limit).toBe('peninsular');
    });

    it('omits geo_limit param when called with undefined/nacional (default)', async () => {
      httpGet.mockReturnValue(
        of(createAxiosResponse(makeRealisticIncluded())),
      );

      await service.fetchDemandaTiempoReal(undefined);
      let [, calledConfig] = httpGet.mock.calls[0];
      expect(calledConfig.params.geo_limit).toBeUndefined();

      httpGet.mockClear();

      await service.fetchDemandaTiempoReal(null);
      [, calledConfig] = httpGet.mock.calls[0];
      expect(calledConfig.params.geo_limit).toBeUndefined();
    });

    it('throws InternalServerErrorException with REE detail on 400 JSON errors envelope', async () => {
      const axiosErr = new AxiosError(
        '400 Bad Request',
        '400',
        undefined,
        undefined,
        {
          data: {
            errors: [
              {
                code: 'E400',
                status: '400',
                title: 'Error Interno',
                detail: 'Los datos solicitados no están disponibles',
              },
            ],
          },
          status: 400,
          statusText: 'Bad Request',
          headers: {},
          config: {} as AxiosResponse['config'],
        },
      );
      httpGet.mockReturnValue(throwError(() => axiosErr));

      await expect(
        service.fetchDemandaTiempoReal(undefined),
      ).rejects.toBeInstanceOf(InternalServerErrorException);

      await expect(
        service.fetchDemandaTiempoReal(undefined),
      ).rejects.toMatchObject({
        message: expect.stringContaining(
          'Los datos solicitados no están disponibles',
        ),
        cause: expect.objectContaining({}),
      });
    });

    it('throws InternalServerErrorException when response.data has no "included" (HTML 500 invalid slug)', async () => {
      httpGet.mockReturnValue(of(createAxiosResponse({ data: 'html' })));

      await expect(
        service.fetchDemandaTiempoReal(undefined),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });
});
