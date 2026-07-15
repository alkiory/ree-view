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
  private readonly API_URL =
    process.env.REE_API_URL || process.env.REE_API_URL_ERROR;
  private readonly FRONTERAS_API =
    process.env.REE_FRONTERAS_API_URL || process.env.REE_API_URL_ERROR;

  constructor(private httpService: HttpService) {}

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
