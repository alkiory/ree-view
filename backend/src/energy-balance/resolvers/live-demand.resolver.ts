import { Query, Resolver } from '@nestjs/graphql';

import { LiveDemandSnapshot } from '../dto/live-demand.type';
import { LiveDemandService } from '../services/live-demand.service';

/**
 * Resolver público del snapshot live. A diferencia de
 * `getEnergyBalances` y `getIntercambios`, este query NO acepta input:
 * la data live de REE no tiene rango (es «ahora mismo» + curva del día
 * en curso, decidida por el servidor). Por tanto NO hace falta
 * salvaguarda `plainToInstance` + `validate`: no hay DTO que validar.
 *
 * Throttler global (30/min) cubre este endpoint automáticamente. Si
 * en el futuro necesitamos un cap más bajo (el frontend tiene
 * `pollInterval: 60000`, así que 1 req/min por tab es el peor caso),
 * añadiríamos un `@Throttle({ default: { limit: 60, ttl: 60000 } })`
 * por-resolver.
 */
@Resolver(() => LiveDemandSnapshot)
export class LiveDemandResolver {
  constructor(private readonly liveService: LiveDemandService) {}

  @Query(() => LiveDemandSnapshot, {
    name: 'getLiveSnapshot',
    description:
      'Snapshot de demanda/generación del momento presente + curva horaria del día. TTL interno 60s.',
  })
  async getLiveSnapshot(): Promise<LiveDemandSnapshot> {
    return this.liveService.getSnapshot();
  }
}
