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

  const start = new Date('2025-04-20T00:00:00.000Z');
  const end = new Date('2025-04-20T23:59:59.000Z');

  const createAxiosResponse = <T>(data: T): AxiosResponse<T> => ({
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config: {} as AxiosResponse<T>['config'],
  });

  beforeEach(async () => {
    httpGet = vi.fn();

    // Default env para que el constructor guard (ver §A.1) no falle
    // durante los tests del happy-path. Cada test que necesite el
    // camino fallido hace `delete process.env....` explícito.
    process.env.REE_API_URL = 'http://test.example/energy';
    process.env.REE_FRONTERAS_API_URL = 'http://test.example/fronteras';

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
    delete process.env.REE_API_URL_ERROR;
    vi.clearAllMocks();
  });

  describe('constructor guard (boot pre-flight, §A.1)', () => {
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
      // Lock-in del contrato nuevo (ver §3.14 en agent-memory/CURRENT.md):
      // la causa real llega al cliente Apollo como parte del mensaje
      // (no como string genérico). Una sola aserción `toMatchObject`
      // evita fragilidades con matcher states sucesivos sobre la misma
      // rejected promise.
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
      // Simétrico al test de fetchData: misma política de messaging.
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
});
