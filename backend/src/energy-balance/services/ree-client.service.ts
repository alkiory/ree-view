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

  /**
   * TZ-independent formatter para `YYYY-MM-DD HH:MM` (sin offset).
   *
   * **POR QUÉ getters locales y NO `date.toISOString()`** (Fix B,
   * investigación histórico-vacío investigation):
   *   - La implementación previa usaba `date.toISOString()` que SIEMPRE
   *     convierte a UTC. En servers no-UTC (e.g. CEST = UTC+2 en
   *     verano) `new Date('2026-07-15T00:00:00').toISOString()` da
   *     `2026-07-14T22:00:00.000Z`, lo que:
   *       (a) adelantaba `start_date` al día anterior en el payload a
   *           REE, y
   *       (b) hacía que el `.replace('00:00', '23:59')` quedara
   *           inerte (la substring `00:00` jamás aparece en la salida
   *           de `toISOString()` cuando el server está en CEST — siempre
   *           sale `22:00`/`23:00`), truncando silenciosamente
   *           `end_date` a mitad del día y haciendo que REE devolviera
   *           sólo 22-23h en lugar de 24h.
   *   - Usando `getFullYear/getMonth/getDate` accedemos al día según
   *     el calendario LOCAL del server. Si el server está en UTC,
   *     `local == UTC`. Si está en CEST, la medianoche local sigue
   *     siendo `YYYY-MM-DD 00:00` (no se desfasa). En cualquier TZ,
   *     `end_date` cierra correctamente a `23:59` del mismo día local.
   *
   * **Trade-off explícito**: el contrato "qué día entiende REE" depende
   * de CÓMO se instanció el Date aguas arriba. Si `live-demand.service`
   * hace `new Date('2026-07-15T00:00:00')` (sin `Z`), el día resultante
   * es local 2026-07-15 (independiente del TZ del server). Si el caller
   * construye `new Date(Date.UTC(2026,6,15))`, el día es UTC 2026-07-15.
   * Cualquiera de las dos elecciones es TZ-consistente aquí (no se
   * mezclan sistemas de referencia dentro del mismo request).
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
  async fetchCurrentDemand(region?: string): Promise<number> {
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
      this._liveDateRangeParams(region),
    );
  }

  async fetchDailyDemandCurve(
    region?: string,
  ): Promise<Array<{ h: string; real: number; prevista: number }>> {
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
      this._liveDateRangeParams(region),
    );
  }

  async fetchGenerationMix(region?: string): Promise<{
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
      this._liveDateRangeParams(region),
    );
  }

  /**
   * Phase 2 §3.31 — historical hourly archive (24 hourly points para una
   * fecha pasada en una region dada). El mismo endpoint
   * `demanda-tiempo-real` se usa con un rango explícito de 24h (start=date
   * 00:00, end=date+1 00:00) + `time_trunc=hour` + (opcional) `geo_limit`.
   *
   * REE devuelve los 24 entries del día en `included[0].attributes.content[]`
   * con shape `{ value, datetime, geo_id }`. El extractor reutiliza la
   * misma lógica que `fetchDailyDemandCurve`.
   *
   * POR QUÉ método separado (no extension del live):
   *   Live requiere «ahora» (today 00:00 → tomorrow 00:00); historical
   *   requiere una fecha pasada concreta (`date 00:00 → date+1 00:00`).
   *   Mezclar las dos signatures haría el código confuso.
   *
   * **Fix A (investigación histórico-vacío)**: acepta `dateStr: string`
   * con el input ORIGINAL `YYYY-MM-DD` del DTO. Era param implícito
   * ausente — la versión previa derivaba el día del mensaje de error
   * con `date.toISOString().slice(0,10)` sobre un Date local, lo que en
   * servers no-UTC mostraba un día diferente al que pidió el usuario y
   * hacía creer al debugger que el código restaba 1 día. Ahora el
   * mensaje refleja exactamente lo que el frontend mandó.
   *
   * POR QUÉ param nuevo obligatorio (no opcional con fallback):
   *   Hay un único caller (`LiveDemandService.getHistoricalHourlySnapshot`)
   *   que TIENE el `date` string original. Pasar el string obligatorio
   *   hace el contrato explícito y fail-fast si se olvida en un caller
   *   futuro.
   */
  async fetchHistoricalHourly(
    date: Date,
    dateStr: string,
    region?: string,
  ): Promise<Array<{ h: string; real: number; prevista: number }>> {
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
            `Invalid historical response: empty content for ${region ?? 'nacional'} on ${dateStr}`,
          );
        }
        return merged.map((entry: any) => {
          const hh = String(entry?.datetime ?? '').slice(11, 13) || '00';
          const val = Number(entry?.value ?? 0);
          return { h: `${hh}h`, real: val, prevista: val };
        });
      },
      this._historicalHourlyParams(date, region),
    );
  }

  /**
   * Computa `start_date=today 00:00`, `end_date=tomorrow 00:00`
   * (en UTC, redondeado al inicio del día), `time_trunc=hour`.
   * REE exige ese set para devolver más de un tick por endpoint
   * `tiempo-real` (sin params devuelve 400 "data not available").
   * Reutiliza `formatDate()` para mantener el formato consistente con
   * `fetchData`/`fetchFronteras`.
   *
   * Phase 2 §3.31 — `region?: string` opcional: cuando NO es undefined,
   * añade `geo_limit=<region>` para que REE devuelva solo el geo
   * pedido. Slug mapping se decide en `LiveDemandService` (← `region`
   * hex kebab ya validado por `@IsEnum` en `GetLiveSnapshotInput`).
   *
   * POR QUÉ no agregamos `geo_limit=nacional` (omit siempre):
   *   REE devuelve la peticion nacional completa cuando NO se manda
   *   `geo_limit` (omitir query param). Mandar `?geo_limit=nacional`
   *   mismo da resultado, pero si omitimos evitamos roundtrip extra
   *   de codificar el param. La branch de mapeo en el service
   *   (`region ?? null`) → omit param es el "nacional" implícito.
   */
  private _liveDateRangeParams(region?: string): Record<string, string> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const params: Record<string, string> = {
      // Rango 24h midnight-to-midnight: today 00:00 -> tomorrow 00:00.
      // `isStart=true` sobre `tomorrow` rinde 'tomorrow 00:00' (que es
      // semánticamente "fin del día de hoy"). Usar `isStart=false` aquí
      // produciría 'tomorrow 23:59' = rango de 48h.
      start_date: this.formatDate(today, true),
      end_date: this.formatDate(tomorrow, true),
      time_trunc: 'hour',
    };
    if (region) {
      params.geo_limit = region;
    }
    return params;
  }

  /**
   * Phase 2 §3.31 — params para `fetchHistoricalHourly`: rango explícito
   * de 24h en una fecha pasada concreta. Acepta region opcional con el
   * mismo comportamiento que `_liveDateRangeParams`.
   *
   * POR QUÉ helper separado:
   *   - `_liveDateRangeParams` usa today/tomorrow (server time).
   *   - Historical hourly necesita un `date` específico del caller (pasado).
   *   - `formatDate` se reusa para mantener el shape de date strings
   *     consistente con los otros fetch methods.
   */
  private _historicalHourlyParams(
    date: Date,
    region?: string,
  ): Record<string, string> {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    // Importante: codificamos `end_date` reutilizando `start` con
    // `isStart=false` (= close-of-day a 23:59). Esto evita que
    // `end.setDate(end.getDate() + 1)` avance el día local — un bug
    // sutil que en POST-FIX (getters locales en vez de toISOString)
    // daría un rango de 48h en lugar de 24h, o un end_date de un día
    // distinto al pedido por el usuario.
    const params: Record<string, string> = {
      start_date: this.formatDate(start, true),
      end_date: this.formatDate(start, false),
      time_trunc: 'hour',
    };
    if (region) {
      params.geo_limit = region;
    }
    return params;
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
