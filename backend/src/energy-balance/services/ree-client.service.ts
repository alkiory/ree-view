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
  // Inicializadas en el constructor tras validar env (ver Guard §A.1 abajo).
  // Si los env vars faltan, el servicio falla en boot con un mensaje
  // accionable en lugar del opaco "Invalid URL" de axios (investigación
  // bug A — propuesta §2.3 cambio A.1 aprobada por el usuario).
  private readonly API_URL!: string;
  private readonly FRONTERAS_API!: string;
  private readonly LIVE_API!: string;
  constructor(private httpService: HttpService) {
    // Fail-fast guard: detecta env vars faltantes ANTES de que cualquier
    // fetch corra. Antes de este guard, un dev que olvidaba crear
    // `backend/.env` arrancaba el servidor (MONGODB_URI tiene fallback
    // en §3.2 CURRENT.md) pero cada request fallaba con "Invalid URL"
    // opaco porque `API_URL` quedaba como `undefined` frozen al cierre
    // de este constructor y axios.get(undefined) ⇒ Error("Invalid URL").
    // Agrega todas las vars faltantes en un solo mensaje accionable (en
    // vez de tirar por la primera que falta — el dev debería ver TODAS
    // las que necesita configurar de una).
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

      // Log NO-AxiosError: incluye stack para diagnóstico. REE apiDatos
      // responde 200 OK incluso en errores lógicos (included ausente,
      // dataset vacío, fechas futuras), por lo que `instanceof AxiosError`
      // es `false` y caemos aquí. Propagamos el mensaje original para
      // que el `onError` de Apollo lo muestre tal cual en consola del
      // frontend, en lugar del "Failed to fetch energy data" genérico.
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

  private formatDate(date: Date, isStart: boolean): string {
    const isoString = date.toISOString();
    return isStart
      ? isoString.replace('T', ' ').substring(0, 16) // 2025-04-20 00:00
      : isoString.replace('T', ' ').substring(0, 16).replace('00:00', '23:59');
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

      // Simétrico a `fetchData`: propaga el mensaje real del error y deja
      // el stack en el log para diagnóstico.
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
   * Live data — Fase 2: 3 métodos que alimentan la sección "Datos en
   * tiempo real" del frontend. Resolves Outstanding #17 del CURRENT §6.
   *
   * Pasa de URLs GUESSED (`/es/datos/live/current-demand` etc., que
   * devolvían 500 HTML → log "undefined - undefined" cada 60s bajo §3.27)
   * a indicator IDs reales de `apidatos.ree.es`:
   *
   *   - `demanda/demanda-tiempo-real`         → valor instantáneo + curva 24h real
   *   - `generacion/estructura-generacion`    → mix por tecnología
   *
   * Todos aceptan los params estándar `start_date` + `end_date` +
   * `time_trunc=hour` (REE exige ese set para devolver más de un tick).
   * El helper `_liveDateRangeParams()` los computa con today→tomorrow.
   *
   * NOTE sobre la curva de demanda: hoy usamos el mismo endpoint
   * `demanda-tiempo-real` para current + curve (toma el último valor
   * del array por currentDemand; los 24 entries para la curva). El
   * endpoint separado para demanda prevista (forecast) aún no está
   * confirmado en la probe — `demanda/demanda-prevista` y
   * `demanda/evolucion-demanda` devuelven 500 HTML, lo que descarta esas
   * rutas REE. Por ahora `prevista` en la curva es `= real` (placeholder);
   * cuando aparezca un slug válido lo cableamos. La resiliencia §3.27
   * sigue protegiendo la UI del error-loop 60s mientras tanto.
   */
  async fetchCurrentDemand(): Promise<number> {
    return this.callLiveEndpoint<number>(
      'demanda/demanda-tiempo-real',
      (data) => {
        const groups = Array.isArray(data?.included) ? data.included : [];
        const lastContent =
          groups[groups.length - 1]?.attributes?.content ?? [];
        const last = lastContent[lastContent.length - 1];
        if (!last || typeof last.value !== 'number') {
          throw new Error(
            'Invalid live response: missing numeric "value" field on demanda-tiempo-real',
          );
        }
        return last.value;
      },
      this._liveDateRangeParams(),
    );
  }

  async fetchDailyDemandCurve(): Promise<
    Array<{ h: string; real: number; prevista: number }>
  > {
    return this.callLiveEndpoint<
      Array<{ h: string; real: number; prevista: number }>
    >(
      'demanda/demanda-tiempo-real',
      (data) => {
        const merged: any[] = (
          Array.isArray(data?.included) ? data.included : []
        ).flatMap((g: any) => g?.attributes?.content ?? []);
        if (!merged.length) {
          throw new Error(
            'Invalid live response: empty content array in demanda-tiempo-real',
          );
        }
        return merged.map((entry: any) => {
          // datetime format REE: `YYYY-MM-DDTHH:MM:SS.sss+HH:MM`.
          // Slice [11,13) → `HH`. Default `00` si falta (defensivo).
          const hh = String(entry?.datetime ?? '').slice(11, 13) || '00';
          const val = Number(entry?.value ?? 0);
          // previsto = real (placeholder hasta encontrar slug de forecast).
          return { h: `${hh}h`, real: val, prevista: val };
        });
      },
      this._liveDateRangeParams(),
    );
  }

  async fetchGenerationMix(): Promise<{
    renewablePercentageValue: number;
  }> {
    return this.callLiveEndpoint<{ renewablePercentageValue: number }>(
      'generacion/estructura-generacion',
      (data) => {
        const groups = Array.isArray(data?.included) ? data.included : [];
        const lastContent =
          groups[groups.length - 1]?.attributes?.content ?? [];
        const last = lastContent[lastContent.length - 1];
        if (!last) {
          throw new Error(
            'Invalid live response: empty content in estructura-generacion',
          );
        }
        // Shape primario: { renewable: number, nonRenewable: number } en MW.
        const r = Number(last?.renewable);
        const nr = Number(last?.nonRenewable);
        let pct: number;
        if (!Number.isNaN(r) && !Number.isNaN(nr) && r + nr > 0) {
          pct = (r / (r + nr)) * 100;
        } else {
          // Fallback para shapes alternativas: { value: number } o
          // { percentage: number }. Si está en 0..1 → multiplicar ×100.
          const v = Number(last?.value ?? last?.percentage ?? 0);
          pct = v > 0 && v <= 1 ? v * 100 : v;
        }
        return { renewablePercentageValue: Number(pct.toFixed(1)) };
      },
      this._liveDateRangeParams(),
    );
  }

  /**
   * Computa `start_date=today 00:00`, `end_date=tomorrow 00:00`
   * (en UTC, redondeado al inicio del día), `time_trunc=hour`.
   * REE exige ese set para devolver más de un tick por endpoint
   * `tiempo-real` (sin params devuelve 400 "data not available").
   * Reutiliza `formatDate()` para mantener el formato consistente con
   * `fetchData`/`fetchFronteras`.
   */
  private _liveDateRangeParams(): Record<string, string> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return {
      start_date: this.formatDate(today, true),
      end_date: this.formatDate(tomorrow, false),
      time_trunc: 'hour',
    };
  }

  /**
   * Helper privado: GET contra `LIVE_API/<pathSuffix>` con params
   * opcionales, transforma via `extract()`.
   *
   * Distinción crítica de errores (Outstanding #17 fix):
   *   - HTML Symfony 500 page → slug REE INVÁLIDO. Log `ERROR` (developer-
   *     visible) — NO se silencia via Promise.allSettled (eso solo sirve
   *     para resilience en slugs VÁLIDOS con data lag).
   *   - JSON 4xx con `errors[0].title+detail` → slug válido, data no
   *     publicada. Log `WARN` para que Promise.allSettled (§3.27) degrade
   *     a defaults (0/[]) y la UI NO muestre error 60s loop.
   *   - Non-Axios (network/DNS) → log WARN con stack + InternalServerError
   *     con cause preservado (`extractErrorDetail` del frontend lo
   *     surfacea — ver §3.23).
   */
  private async callLiveEndpoint<R>(
    pathSuffix: string,
    extract: (body: any) => R,
    params?: Record<string, string>,
  ): Promise<R> {
    const url = `${this.LIVE_API}/${pathSuffix}`;
    try {
      this.logger.debug(
        `Calling REE live endpoint: ${url} (params: ${JSON.stringify(params ?? {})})`,
      );
      const httpOptions = params ? { params } : {};
      const response = await firstValueFrom(
        this.httpService.get(url, httpOptions),
      );
      return extract(response.data);
    } catch (error) {
      if (error instanceof AxiosError) {
        const apiError = error.response?.data?.errors?.[0] || {};
        // Axios headers['content-type'] es del tipo
        // `AxiosHeaderValue = string | string[] | number | boolean | null`.
        // Narrowing explícito a string antes de invocar `.includes()`
        // silencia TS2339 sin perder la intención de detección.
        const rawCt = error.response?.headers?.['content-type'];
        const contentType = typeof rawCt === 'string' ? rawCt : '';
        const isHtml = contentType.includes('text/html');

        if (isHtml) {
          // Invalid slug — 500 HTML de Symfony. Acción: log ERROR (no
          // WARN) porque NO es recoverable por resilience — es config
          // bug que requiere cambio del pathSuffix.
          this.logger.error(
            `REE live API invalid slug [${pathSuffix}]: Symfony 500 HTML response — verifica el indicator path en backend/.env.example`,
          );
        } else {
          // Valid slug pero data not published / 4xx normal. Log WARN —
          // §3.27 Promise.allSettled capturará la rejection y degrades
          // a defaults.
          const msg =
            apiError.detail ||
            apiError.title ||
            `HTTP ${error.response?.status ?? '?'}`;
          this.logger.warn(`↻ Live snapshot partial — ${pathSuffix}: ${msg}`);
        }

        throw new InternalServerErrorException(
          apiError.detail || `Error fetching live data (${pathSuffix})`,
          {
            cause: error,
            description: `API Error ${error.response?.status ?? '?'}: ${
              apiError.title ?? '-'
            }`,
          },
        );
      }

      // Non-Axios: network/DNS/etc. Log WARN (degraded es OK por §3.27).
      const detail = error?.message || 'non-Axios error in ree-client (live)';
      this.logger.warn(
        `↻ Live snapshot partial — ${pathSuffix}: ${detail}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new InternalServerErrorException(
        `Failed to fetch live data: ${detail}`,
        { cause: error },
      );
    }
  }
}
