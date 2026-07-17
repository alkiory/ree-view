import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';

@Injectable()
export class ReeClientService {
  private readonly logger = new Logger(ReeClientService.name);
  private readonly API_URL!: string;
  private readonly FRONTERAS_API!: string;
  /** Base URL de los endpoints live REE. */
  private readonly LIVE_API!: string;
  constructor(private httpService: HttpService) {
    const missing: string[] = [];
    const apiUrl = process.env.REE_API_URL || process.env.REE_API_URL_ERROR;
    const fronterasApiUrl =
      process.env.REE_FRONTERAS_API_URL || process.env.REE_API_URL_ERROR;
    const liveApiUrl =
      process.env.REE_LIVE_API_URL || process.env.REE_API_URL_ERROR;
    if (!apiUrl) missing.push('REE_API_URL');
    if (!fronterasApiUrl) missing.push('REE_FRONTERAS_API_URL');
    if (!liveApiUrl) missing.push('REE_LIVE_API_URL');
    if (missing.length > 0) {
      const list = missing.join(' y ');
      const msg = `${list} no configurado${missing.length > 1 ? 's' : ''}. Crea backend/.env desde backend/.env.example o setea ${missing.length > 1 ? 'las variables' : 'la variable'} en tu runtime antes de iniciar el servidor.`;
      this.logger.error(`[boot] ${msg}`);
      throw new Error(msg);
    }
    this.API_URL = apiUrl;
    this.FRONTERAS_API = fronterasApiUrl;
    this.LIVE_API = liveApiUrl;
  }

  async fetchData({ start, end }: { start: Date; end: Date }) {
    try {
      const params = {
        start_date: this.formatDate(start, true),
        end_date: this.formatDate(end, false),
        time_trunc: 'day',
        cached: 'true',
      };

      this.logger.debug(
        `Calling REE API Energy with params: ${JSON.stringify(params)}`,
      );

      const response = await firstValueFrom(
        this.httpService.get(this.API_URL, { params }),
      );

      if (!response.data?.included) {
        throw new Error('Invalid API response: missing "included" field');
      }

      return response.data.included.flatMap((group: any) => {
        if (
          !group.attributes?.content ||
          !Array.isArray(group.attributes.content)
        ) {
          this.logger.warn(`Group ${group.id} has invalid content`);
          return [];
        }

        return group.attributes.content.map((valueEntry: any) => ({
          startDate: start,
          endDate: end,
          id: valueEntry.id,
          type: valueEntry.type,
          groupId: valueEntry.groupId,
          attributes: valueEntry.attributes,
        }));
      });
    } catch (error) {
      if (error instanceof AxiosError) {
        const apiError = error.response?.data?.errors?.[0] || {};
        this.logger.error(
          `REE API Error: ${apiError.title} - ${apiError.detail}`,
        );
        throw new InternalServerErrorException(
          apiError.detail || 'Error fetching data from REE API',
          {
            cause: error,
            description: `API Error ${apiError.code}: ${apiError.status}`,
          },
        );
      }

      const detail = error?.message || 'non-Axios error in ree-client';
      this.logger.error(
        `REE => Unexpected error: ${detail}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new InternalServerErrorException(
        `Failed to fetch energy data: ${detail}`,
        { cause: error },
      );
    }
  }

  /**
   * Formatea un Date a `YYYY-MM-DD HH:MM` usando getters locales (no
   * UTC), idempotente cross-TZ.
   */
  private formatDate(date: Date, isStart: boolean): string {
    const yyyy = date.getFullYear();
    const MM = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = isStart ? '00:00' : '23:59';
    return `${yyyy}-${MM}-${dd} ${hh}`;
  }

  async fetchFronteras({ start, end }: { start: Date; end: Date }) {
    try {
      const params = {
        start_date: this.formatDate(start, true),
        end_date: this.formatDate(end, false),
        time_trunc: 'day',
        cached: 'true',
      };

      this.logger.debug(
        `Calling REE API Fronteras with params: ${JSON.stringify(params)}`,
      );

      const response = await firstValueFrom(
        this.httpService.get(this.FRONTERAS_API, { params }),
      );

      if (!response.data?.included) {
        throw new Error('Invalid API response: missing "included" field');
      }

      return response.data.included.flatMap((group: any) => {
        if (
          !group.attributes?.content ||
          !Array.isArray(group.attributes.content)
        ) {
          this.logger.warn(`Group ${group.id} has invalid content`);
          return [];
        }

        return group.attributes.content;
      });
    } catch (error) {
      if (error instanceof AxiosError) {
        const apiError = error.response?.data?.errors?.[0] || {};
        this.logger.error(
          `REE API Error: ${apiError.title} - ${apiError.detail}`,
        );
        throw new InternalServerErrorException(
          apiError.detail || 'Error fetching data from REE API',
          {
            cause: error,
            description: `API Error ${apiError.code}: ${apiError.status}`,
          },
        );
      }

      const detail = error?.message || 'non-Axios error in ree-client';
      this.logger.error(
        `Frontera => Unexpected error: ${detail}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new InternalServerErrorException(
        `Failed to fetch energy data: ${detail}`,
        { cause: error },
      );
    }
  }

  /**
   * Wrapper privado para endpoints live REE. Estima el rango default a
   * hoy (00:00–23:59 local) y permite override vía `opts.date`.
   */
  private async callLiveEndpoint<R>(
    pathSuffix: string,
    extract: (data: any) => R,
    opts: { date?: Date; extraParams?: Record<string, string> } = {},
  ): Promise<R> {
    const start_date = opts.date
      ? this.toLocalISO(opts.date, '00:00')
      : this.liveStartDate();
    const end_date = opts.date
      ? this.toLocalISO(opts.date, '23:59')
      : this.liveEndDate();
    const fullParams = {
      start_date,
      end_date,
      time_trunc: 'hour',
      cached: 'true',
      ...(opts.extraParams ?? {}),
    };
    const baseUrl = this.LIVE_API.replace(/\/+$/, '');
    try {
      const response = await firstValueFrom(
        this.httpService.get(`${baseUrl}/${pathSuffix}`, {
          params: fullParams,
        }),
      );
      if (!response.data?.included) {
        throw new Error(
          `Invalid live API response for ${pathSuffix}: missing "included" field`,
        );
      }
      return extract(response.data);
    } catch (error) {
      if (error instanceof AxiosError) {
        const apiError = error.response?.data?.errors?.[0] || {};
        const detail = apiError.detail
          ? `${apiError.title || 'REE error'}: ${apiError.detail}`
          : `REE API error at ${pathSuffix}`;
        this.logger.error(
          `REE live API Error [${pathSuffix}]: ${apiError.title || 'unknown'} - ${apiError.detail || 'unknown'}`,
        );
        throw new InternalServerErrorException(detail, {
          cause: error,
          description: `API Error ${apiError.code || '?'}: ${apiError.status || '?'}`,
        });
      }
      const msg = error?.message || 'non-Axios error in live API';
      this.logger.error(
        `REE live => Unexpected error at ${pathSuffix}: ${msg}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new InternalServerErrorException(
        `Failed to fetch live data: ${msg}`,
        { cause: error },
      );
    }
  }

  /** Devuelve `YYYY-MM-DDTHH:MM` (start = 00:00 local) para hoy. */
  private liveStartDate(): string {
    const d = new Date();
    return this.toLocalISO(d, '00:00');
  }

  /** Devuelve `YYYY-MM-DDTHH:MM` (end = 23:59 local) para hoy. */
  private liveEndDate(): string {
    const d = new Date();
    return this.toLocalISO(d, '23:59');
  }

  /**
   * Formatea `YYYY-MM-DDTHH:MM` con getters locales (no `toISOString`,
   * que siempre opera en UTC).
   */
  private toLocalISO(d: Date, hhmm: string): string {
    const yyyy = d.getFullYear();
    const MM = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${MM}-${dd}T${hhmm}`;
  }

  /**
   * Llama a `demanda/demanda-tiempo-real` para una fecha (hoy o
   * histórica). Devuelve las 4 series con granularidad 5-min
   * (`Real`, `Prevista`, `Programada`, `Programada total`).
   */
  async fetchDemandaTiempoReal(
    geoLimit?: string | null,
    date?: Date,
  ): Promise<
    Array<{
      type: string;
      values: { value: number; percentage: number; datetime: string }[];
    }>
  > {
    const extraParams = geoLimit ? { geo_limit: geoLimit } : {};
    return this.callLiveEndpoint(
      'demanda/demanda-tiempo-real',
      (data: { included: Array<{ attributes?: { title?: string; values?: any[] } }> }) =>
        (data.included ?? []).map((it: any) => ({
          type: String(it?.attributes?.title ?? ''),
          values: (it?.attributes?.values ?? []).map((v: any) => ({
            value: Number(v?.value ?? 0),
            percentage: Number(v?.percentage ?? 0),
            datetime: String(v?.datetime ?? ''),
          })),
        })),
      { date, extraParams },
    );
  }

  /**
   * Llama a `generacion/estructura-generacion` para obtener el mix
   * renewable/no-renewable como porcentaje (0..100).
   */
  async fetchGenerationMix(
    geoLimit?: string | null,
    date?: Date,
  ): Promise<{ renewablePercentageValue: number }> {
    const extraParams = geoLimit ? { geo_limit: geoLimit } : {};
    return this.callLiveEndpoint(
      'generacion/estructura-generacion',
      (data: any) => {
        const RENEWABLE_CATEGORIES: ReadonlySet<string> = new Set([
          'Hidráulica',
          'Eólica',
          'Solar fotovoltaica',
          'Solar térmica',
          'Otras renovables',
          'Residuos renovables',
        ]);
        const included = data.included ?? [];
        let total = 0;
        let renewable = 0;
        for (const group of included) {
          const title = String(group?.attributes?.title ?? '').trim();
          const isRenewable = RENEWABLE_CATEGORIES.has(title);
          const values: any[] = group?.attributes?.values ?? [];
          for (const v of values) {
            const value = Number(v?.value ?? 0);
            total += value;
            if (isRenewable) renewable += value;
          }
        }
        const pct = total > 0 ? (renewable / total) * 100 : 0;
        return { renewablePercentageValue: Number(pct.toFixed(2)) };
      },
      { date, extraParams },
    );
  }
}
