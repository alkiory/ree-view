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
  /**
   * §3.37 — restaurado. Base URL de los endpoints live REE
   * (`demanda/demanda-tiempo-real`, `generacion/estructura-generacion`).
   * Formato: `${REE_LIVE_API_URL}` — slash final opcional.
   */
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
    //
    // §3.36 — histórico: la var `REE_LIVE_API_URL` ya no es necesaria.
    // La sección live-demand del frontend (Phase 2 §3.31–§3.35) se
    // reemplazó por un mock estático (`MockLiveDemandCard`) que no
    // toca esta API. Por tanto la guard sólo valida las 2 vars que
    // quedan activas: balance + fronteras.
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
   * §3.33): `date.toISOString()` siempre convierte a UTC, lo que en
   * servers no-UTC (CEST = UTC+2 en verano) adelantaba el día al
   * anterior en el payload a REE. Usando `getFullYear/getMonth/getDate`
   * accedemos al día según el calendario LOCAL del server, idempotente
   * cross-TZ. `end_date` cierra correctamente a `23:59` del mismo día
   * local en cualquier TZ.
   *
   * Se mantiene aquí porque `fetchData` y `fetchFronteras` la usan.
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
   * §3.37 — Live-demand methods RESTAURADOS tras investigación real
   * (ver §2.1 de la propuesta). El endpoint correcto para histórico
   * horario NO es `demanda/evolucion` (que solo rinde 1 valor/día) sino
   * `demanda/demanda-tiempo-real`, que devuelve 4 series × 288 ticks
   * de 5 min (idénticos al sliding-window del live pero disponibles
   * para CUALQUIER fecha pasada). §3.36 los había eliminado por un
   * diagnóstico precipitado; ahora se re-introducen como
   * `fetchDemandaTiempoReal` (canonical) + `fetchGenerationMix`
   * (mix renewable, endpoint separado).
   */

  /**
   * §3.37 — Wrapper privado para todos los endpoints live REE.
   *
   *   - URL: `${this.LIVE_API}/${pathSuffix}` (la LIVE_API se
   *     configuró sin slash final; lo añadimos aquí si falta).
   *   - Params default: `start_date=todayLocal00:00`, `end_date=
   *     todayLocal23:59`, `time_trunc=hour`, `cached=true`. El caller
   *     puede overridear `geo_limit` etc. con `params` extra.
   *   - Discriminación de error:
   *       - JSON `{errors: [...]}` → API válida con data lag → `detail`
   *         propagado como InternalServerErrorException con `cause`.
   *       - HTML Symfony 500 → slug inválido (config bug) → mismo
   *         throw con `description` específica.
   *       - Non-Axios (network/DNS) → log con stack + throw con
   *         mensaje verbatim (`Failed to fetch live data: …`).
   *
   * TZ handling: `liveStartDate()`/`liveEndDate()` usan los getters
   * LOCALES (getFullYear/getMonth/getDate) — NO `toISOString()` que
   * convierte a UTC y adelanta el día al anterior en servidores CEST
   * (cf. §3.33 fix B). El formato YYYY-MM-DDTHH:MM es lo que REE
   * parsea consistentemente.
   */
  private async callLiveEndpoint<R>(
    pathSuffix: string,
    extract: (data: any) => R,
    opts: { date?: Date; extraParams?: Record<string, string> } = {},
  ): Promise<R> {
    // §3.37 — el `date` opcional permite a callers pedir un historical
    // rango concreto (ej. ayer para `getHistoricalHourlySnapshot`).
    // Si se omite, usamos hoy (live snapshot path).
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

  /** TZ-independent formatter para `YYYY-MM-DDTHH:MM` (start = 00:00 local). */
  private liveStartDate(): string {
    const d = new Date();
    return this.toLocalISO(d, '00:00');
  }

  /** TZ-independent formatter para `YYYY-MM-DDTHH:MM` (end = 23:59 local). */
  private liveEndDate(): string {
    const d = new Date();
    return this.toLocalISO(d, '23:59');
  }

  /**
   * TZ-independent formatter para `YYYY-MM-DDTHH:MM`. Usa getters
   * LOCALES (`getFullYear/getMonth/getDate/getHours/getMinutes`) — no
   * `toISOString()` que siempre opera en UTC. Cross-TZ idempotente
   * (cf. Fix B §3.33).
   */
  private toLocalISO(d: Date, hhmm: string): string {
    const yyyy = d.getFullYear();
    const MM = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${MM}-${dd}T${hhmm}`;
  }

  /**
   * §3.37 — `fetchDemandaTiempoReal` (canonical, nuevo nombre).
   *
   * Llama al endpoint REE `demanda/demanda-tiempo-real` que devuelve,
   * para una fecha (today por default, o cualquier histórica via
   * `getSnapshot`/`getHistoricalHourlySnapshot` que ajusten
   * manualmente `liveStartDate`/`liveEndDate` — ver TODO §6 si se
   * generaliza), 4 series con granularidad 5-min:
   *
   *   - Real (id=2037)          → la curva "real" del frontend
   *   - Prevista (id=2052)      → la curva "forecast" del frontend
   *   - Programada              → no usado por el dashboard (kept raw)
   *   - Programada total        → no usado por el dashboard (kept raw)
   *
   * Devuelve los items parseados como `{ type, values[] }` para que el
   * aggregator (`util/aggregate-hourly.ts:buildDemandCurve`) pueda
   * extraer el shape `demandCurve` del `LiveDemandSnapshot` sin
   * conocer el shape raw de REE.
   *
   *   `geoLimit`: kebab-case opcional ('peninsular' | 'baleares' |
   *   'canarias' | 'ceuta' | 'melilla') para sub-regiones. `undefined`
   *   o `null` → omite el param → REE devuelve el agregado nacional.
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
   * §3.37 — `fetchGenerationMix` (restaurado de §3.32).
   *
   * Endpoint separado `generacion/estructura-generacion`. NO usa
   * `demanda-tiempo-real` porque esa solo reporta totales — el mix
   * renewable/no-renewable vive en una indicator distinta.
   *
   * Devuelve `{ renewablePercentageValue: number }` (0..100). En el
   * historical path (ayer) este endpoint devuelve la misma estructura
   * pero con data del día anterior — propagamos tal cual al snapshot.
   */
  async fetchGenerationMix(
    geoLimit?: string | null,
    date?: Date,
  ): Promise<{ renewablePercentageValue: number }> {
    const extraParams = geoLimit ? { geo_limit: geoLimit } : {};
    return this.callLiveEndpoint(
      'generacion/estructura-generacion',
      (data: any) => {
        // §3.37 — categorías renewable canónicas REE (alineado con
        // §3.29/§3.30 design tokens `RENEWABLE_MIX` + redondeo por
        // nombres que apidatos.ree.es publica en `estructura-generacion`
        // para data del sistema peninsular español).
        //
        // Lista cerrada (no fuzzy match por `includes('renov')` que
        // sería frágil — code-reviewer §3.37 flagged).
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