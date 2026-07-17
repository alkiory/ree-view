import { Query, Resolver, Args } from '@nestjs/graphql';

import { LiveDemandSnapshot } from '../dto/live-demand.type';
import {
  GetLiveSnapshotInput,
  HistoricalHourlyInput,
} from '../dto/live-demand.input';
import { LiveDemandService } from '../services/live-demand.service';

/**
 * Resolver público del snapshot live + historical archive.
 *
 * Phase 2 §3.31:
 *   - `getLiveSnapshot(input)` ahora acepta `GetLiveSnapshotInput?` con
 *     `region?: LiveDemandRegionSlug`. Input omitido = comportamiento
 *     pre-§3.31 (Nacional implicit), backward-compat con clientes que
 *     no envían region.
 *   - `getHistoricalHourlySnapshot(input)` NUEVO: devuelve snapshot de
 *     una fecha pasada, para el fallback del frontend cuando live
 *     está degraded (zero-sentinels §3.27).
 *
 * Throttler global (30/min) cubre ambos endpoints automáticamente. Si
 * en el futuro necesitamos un cap más bajo (live tiene poll 60s/tab +
 * historical sólo se invoca en degraded state), añadiríamos un
 * `@Throttle({ default: { limit: 60, ttl: 60000 } })` por-resolver.
 */
@Resolver(() => LiveDemandSnapshot)
export class LiveDemandResolver {
  constructor(private readonly liveService: LiveDemandService) {}

  /**
   * Snapshot live. `input?: GetLiveSnapshotInput` — el signo `?`
   * significa opcional. Validación de `region` es automática por
   * NestJS (`@IsOptional` en DTO), así que un cliente que omita la
   * key entera queda como `undefined` (que `LiveDemandService` mapea
   * a cacheKey 'NACIONAL' — enum value, §3.41).
   */
  @Query(() => LiveDemandSnapshot, {
    name: 'getLiveSnapshot',
    description:
      'Snapshot live de demanda/generación del momento presente + curva horaria del día. Acepta region opcional (Phase 2 §3.31). TTL interno 60s.',
  })
  async getLiveSnapshot(
    @Args('input', { type: () => GetLiveSnapshotInput, nullable: true })
    input?: GetLiveSnapshotInput,
  ): Promise<LiveDemandSnapshot> {
    return this.liveService.getSnapshot(input?.region);
  }

  /**
   * Phase 2 §3.31 — historical hourly archive.
   *
   * El frontend invoca este resolver cuando el live snapshot está
   * degraded (zero-sentinels). shape y shape contract son idénticos
   * a `getLiveSnapshot` para que el componente swap-render sin tipo
   * checker complaints.
   *
   * Nota: `date` es `String` (no `ID`) porque es YYYY-MM-DD; un ISO
   * datetime completo sería overconstrained (REE devuelve por hora,
   * no por minuto).
   */
  @Query(() => LiveDemandSnapshot, {
    name: 'getHistoricalHourlySnapshot',
    description:
      'Snapshot histórico de demanda por hora para una fecha y region dadas. Sin cache interno (TTL 24h en columna separada pendiente).',
  })
  async getHistoricalHourlySnapshot(
    @Args('input', { type: () => HistoricalHourlyInput })
    input: HistoricalHourlyInput,
  ): Promise<LiveDemandSnapshot> {
    return this.liveService.getHistoricalHourlySnapshot(
      input.date,
      input.region,
    );
  }
}
