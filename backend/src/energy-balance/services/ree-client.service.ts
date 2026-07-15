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
    if (!apiUrl) missing.push('REE_API_URL');
    if (!fronterasApiUrl) missing.push('REE_FRONTERAS_API_URL');
    if (missing.length > 0) {
      const list = missing.join(' y ');
      const msg = `${list} no configurado${missing.length > 1 ? 's' : ''}. Crea backend/.env desde backend/.env.example o setea ${missing.length > 1 ? 'las variables' : 'la variable'} en tu runtime antes de iniciar el servidor.`;
      this.logger.error(`[boot] ${msg}`);
      throw new Error(msg);
    }
    this.API_URL = apiUrl;
    this.FRONTERAS_API = fronterasApiUrl;
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
}
