import { Query, Resolver, Args } from '@nestjs/graphql';

import { LiveDemandSnapshot } from '../dto/live-demand.type';
import {
  GetLiveSnapshotInput,
  HistoricalHourlyInput,
} from '../dto/live-demand.input';
import { LiveDemandService } from '../services/live-demand.service';

/**
 * Resolver público del snapshot live + historical archive. Ambos
 * endpoints comparten el throttler global (30/min).
 */
@Resolver(() => LiveDemandSnapshot)
export class LiveDemandResolver {
  constructor(private readonly liveService: LiveDemandService) {}

  /**
   * Snapshot live. `input` es opcional: omitirlo = `region: undefined`
   * → cacheKey `NACIONAL` en el service layer.
   */
  @Query(() => LiveDemandSnapshot, {
    name: 'getLiveSnapshot',
    description:
      'Snapshot live de demanda/generación del momento presente + curva horaria del día. Acepta region opcional.',
  })
  async getLiveSnapshot(
    @Args('input', { type: () => GetLiveSnapshotInput, nullable: true })
    input?: GetLiveSnapshotInput,
  ): Promise<LiveDemandSnapshot> {
    return this.liveService.getSnapshot(input?.region);
  }

  /**
   * Snapshot histórico horario. Shape idéntico a `getLiveSnapshot`
   * para swap-render sin type checker complaints.
   */
  @Query(() => LiveDemandSnapshot, {
    name: 'getHistoricalHourlySnapshot',
    description:
      'Snapshot histórico de demanda por hora para una fecha y region dadas.',
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
