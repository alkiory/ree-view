import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { ReeClientService } from './services/ree-client.service';

// El debug-controller (ree-client) expone la API interna sin pasar por
// GraphQL. Lo rate-limitamos más estricto (5 req/min) para evitar abuso:
// si solo lo usas en local, el global de 30/min también es suficiente.
const DEBUG_THROTTLE_LIMIT = Number(process.env.DEBUG_THROTTLE_LIMIT) || 5;
const THROTTLE_TTL_MS = Number(process.env.THROTTLE_TTL_MS) || 60_000;

@Controller('ree-client')
@Throttle({ default: { limit: DEBUG_THROTTLE_LIMIT, ttl: THROTTLE_TTL_MS } })
export class DebugController {
  constructor(private readonly reeClient: ReeClientService) {}

  @Post()
  async getData(@Body() body: { start?: Date; end?: Date }) {
    const { start, end } = body;
    if (!start || !end) {
      throw new BadRequestException(
        'Parameters "start" and "end" are required.',
      );
    }

    const startDate = new Date(start);
    const endDate = new Date(end);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new BadRequestException(
        'Parameters "start" and "end" must be valid dates in ISO 8601 format.',
      );
    }

    if (startDate > endDate) {
      throw new BadRequestException('"Start" date must be before "end" date.');
    }

    return this.reeClient.fetchData({ start: startDate, end: endDate });
  }

  // Bypass del rate-limit para smoke tests de humo / debugging.
  @SkipThrottle()
  @Get('test-ree')
  async testREE() {
    const start = new Date('2025-04-20');
    const end = new Date('2025-04-20');
    return this.reeClient.fetchData({ start, end });
  }

  @Post('frontera')
  async getFronteraData(@Body() body: { start?: Date; end?: Date }) {
    const { start, end } = body;
    return this.reeClient.fetchFronteras({ start, end });
  }

  @SkipThrottle()
  @Get('test-ree-frontera')
  async testREEFronteras() {
    const start = new Date('2025-04-19');
    const end = new Date('2025-04-19');
    return await this.reeClient.fetchFronteras({ start, end });
  }
}
