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

  // FIX B TZ-portability: las fechas se construyen con `new Date(yyyy,
  // mm, dd, ...)` (LOCAL midnight) en lugar de `.000Z` (UTC midnight).
  // Antes del fix, `formatDate(end, ...)` usaba `.toISOString()` que
  // devolvía UTC, así que el test sólo pasaba en runners UTC. Ahora
  // `formatDate` usa getters locales → el día es estable cross-TZ.
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

    // Default env para que el constructor guard (ver §A.1) no falle
    // durante los tests del happy-path. Cada test que necesite el
    // camino fallido hace `delete process.env....` explícito.
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

  /**
   * Fix A (investigación histórico-vacío): `fetchHistoricalHourly` ahora
   * acepta `dateStr: string` con el input ORIGINAL del DTO y lo usa
   * verbatim en el mensaje de error. Antes derivaba el día de
   * `date.toISOString().slice(0,10)` (UTC-shift en servers no-UTC).
   *
   * Fix B (zone-independent formatDate): los `params` a REE deben llevar
   * `start_date=YYYY-MM-DD 00:00` / `end_date=YYYY-MM-DD 23:59` del día
   * local del servidor, sin UTC-shift ni replace-muerto.
   */
  describe('fetchHistoricalHourly (Fix A + Fix B)', () => {
    /**
     * Estructura helper que refleja EXACTAMENTE la respuesta real de REE
     * para fechas sin datos publicados (probe ground-truth de la
     * investigación): `included` con 4 grupos (Prevista/Programada/Real/
     * Programada total), todos con `content=[]`, sin `errors[]` y sin
     * `links.next`. Esto es la firma diagnóstica de "REE no tiene data",
     * no de un error de protocol.
     */
    const EMPTY_CONTENT_FROM_REE = {
      included: [
        {
          id: '2052',
          type: 'Prevista',
          attributes: { content: [] },
        },
        {
          id: '2053',
          type: 'Programada',
          attributes: { content: [] },
        },
        {
          id: '2037',
          type: 'Real',
          attributes: { content: [] },
        },
        {
          id: '2054',
          type: 'Programada total',
          attributes: { content: [] },
        },
      ],
    };

    /**
     * FIX A — Test 1: el mensaje de error contiene el `dateStr` del input
     * del DTO (`2026-07-15`), NO el `date.toISOString().slice(0,10)` UTC
     * shifted (`2026-07-14` en CEST).
     */
    it('A1: error message contains the input dateStr (not UTC-shifted date)', async () => {
      httpGet.mockReturnValue(of(createAxiosResponse(EMPTY_CONTENT_FROM_REE)));

      // El Date es local-CEST a propósito: expone el bug pre-fix.
      const parsed = new Date('2026-07-15T00:00:00');

      await expect(
        service.fetchHistoricalHourly(parsed, '2026-07-15'),
      ).rejects.toThrow(
        'Invalid historical response: empty content for nacional on 2026-07-15',
      );
    });

    /**
     * FIX A — Test 2 (happy path): cuando REE devuelve contenido, el
     * shape mapea correctamente a `{h, real, prevista}`. `prevista=real`
     * es placeholder intencional (ver docstring §3.28 de la service).
     */
    it('A2: maps the hourly REE content to {h, real, prevista} entries', async () => {
      httpGet.mockReturnValue(
        of(
          createAxiosResponse({
            included: [
              {
                id: 'real',
                type: 'Real',
                attributes: {
                  content: [
                    {
                      datetime: '2026-07-15T00:00:00.000+02:00',
                      value: 24000,
                    },
                    {
                      datetime: '2026-07-15T01:00:00.000+02:00',
                      value: 23000,
                    },
                  ],
                },
              },
            ],
          }),
        ),
      );

      const parsed = new Date('2026-07-15T00:00:00');
      const result = await service.fetchHistoricalHourly(
        parsed,
        '2026-07-15',
      );

      expect(result).toEqual([
        { h: '00h', real: 24000, prevista: 24000 },
        { h: '01h', real: 23000, prevista: 23000 },
      ]);
    });

    /**
     * FIX B — Test 1 (golden bug-exposer): independientemente del TZ
     * del test runner, `new Date(yyyy, mm, dd, 0, 0, 0)` representa
     * la medianoche LOCAL del día pedido. Con getters locales, los
     * `params` siempre serán `start_date=YYYY-MM-DD 00:00` /
     * `end_date=YYYY-MM-DD 23:59` — sin UTC-shift que el bug pre-fix
     * introducía en CEST.
     *
     * Caveat: este test PASS post-fix en cualquier TZ. En runner UTC,
     * la versión pre-fix también lo pasaba (porque `end.toISOString()`
     * sí contenía `00:00` en UTC). La validación contra el UTC-shift es
     * cruzada con el B2 + con la verificación runtime de la investigación.
     */
    it('B1: uses local getters to format start_date=YYYY-MM-DD 00:00 and end_date=YYYY-MM-DD 23:59', async () => {
      httpGet.mockReturnValue(
        of(
          createAxiosResponse({
            included: [
              {
                id: 'real',
                type: 'Real',
                attributes: {
                  content: [
                    { datetime: '2026-07-15T00:00:00.000Z', value: 100 },
                  ],
                },
              },
            ],
          }),
        ),
      );

      // Local midnight: misma fecha en cualquier TZ del runner.
      const localMidnight = new Date(2026, 6, 15, 0, 0, 0);

      await service.fetchHistoricalHourly(localMidnight, '2026-07-15');

      const [, config] = httpGet.mock.calls[0];
      expect(config.params.start_date).toBe('2026-07-15 00:00');
      expect(config.params.end_date).toBe('2026-07-15 23:59');
      expect(config.params.time_trunc).toBe('hour');
      // region=undefined → omit `geo_limit` (nacional implícito).
      expect(config.params.geo_limit).toBeUndefined();
    });

    /**
     * FIX B — Test 2 (cross-TZ portable): el formateador extrae el día del
     * calendario LOCAL del Date que el caller construyó, y la assertion
     * usa los getters dinámicos del MISMO Date — lo que garantiza
     * idempotencia cross-TZ del runner sin depender de stubs runtime
     * (Node 20 / V8 cachea TZ al startup, por lo que `vi.stubEnv('TZ')`
     * no surte efecto en este proceso long-lived).
     *
     * Caveat: B1 (arriba) y B2 prueban el mismo contrato con dos estilos
     * de assertion distintos. B1 usa string fijo hardcoded (`'2026-07-15'`)
     * construido sobre `new Date(2026, 6, 15, 0, 0, 0)` (que es local
     * midnight en CUALQUIER TZ del runner, por construcción). B2 usa los
     * getters dinámicos sobre `new Date('2026-07-15T00:00:00')` (sin Z,
     * wall-clock local). Son equivalentes; la diferencia es para mostrar
     * que el formatter respeta el contrato tanto con constructor
     * posicional como con string ISO sin sufijo.
     */
    it('B2: formatDate is TZ-independent — derives day from local getters of the input Date', async () => {
      httpGet.mockReturnValue(
        of(
          createAxiosResponse({
            included: [
              {
                id: 'real',
                type: 'Real',
                attributes: {
                  content: [
                    {
                      datetime: '2026-07-15T00:00:00.000Z',
                      value: 100,
                    },
                  ],
                },
              },
            ],
          }),
        ),
      );

      // Sin offset TZ: la fecha se interpreta como LOCAL-TZ del server.
      const parsedFromDTO = new Date('2026-07-15T00:00:00');

      await service.fetchHistoricalHourly(parsedFromDTO, '2026-07-15');

      const [, config] = httpGet.mock.calls[0];
      // Dynamic getters del MISMO Date que se pasa al servicio: así la
      // assertion es estable cross-TZ del runner. El contrato del
      // formatter es "el día que el caller construyó como local midnight".
      const yyyy = parsedFromDTO.getFullYear();
      const MM = String(parsedFromDTO.getMonth() + 1).padStart(2, '0');
      const dd = String(parsedFromDTO.getDate()).padStart(2, '0');

      expect(config.params.start_date).toBe(`${yyyy}-${MM}-${dd} 00:00`);
      expect(config.params.end_date).toBe(`${yyyy}-${MM}-${dd} 23:59`);
    });
  });
});
