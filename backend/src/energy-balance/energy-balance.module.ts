import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HttpModule } from '@nestjs/axios';
import {
  EnergyBalance,
  EnergyBalanceSchema,
} from './schemas/energy-balance.schema';
import { EnergyBalanceService } from './services/energy-balance.service';
import { ReeClientService } from './services/ree-client.service';
import { EnergyBalanceResolver } from './resolvers/energy-balance.resolver';
import { FronteraService } from './services/frontera.service';
import { Frontera, FronteraSchema } from './schemas/frontier-schema';
import { FronteraResolver } from './resolvers/frontera.resolver';
// §3.40 — live-demand re-cabling.
//
// §3.36 borró los archivos `live-demand.*`; §3.37 restauró el código
// fuente (schema, service, resolver) pero NO los cableó aquí. Resultado:
// `autoSchemaFile: true` no podía introspectar los `@Query` ni el enum
// `LiveDemandRegionSlug` → `GRAPHQL_VALIDATION_FAILED` desde el frontend.
//
// Los 3 registros que faltaban, ahora añadidos abajo:
//   - `forFeature`: schema `LiveDemand` (TTL 60s).
//   - `providers`: `LiveDemandService` + `LiveDemandResolver` (este
//     último es lo que expone los `@Query` a la schema auto-generada).
import {
  LiveDemandHistorical,
  LiveDemandHistoricalSchema,
} from './schemas/live-demand-historical.schema';
import { LiveDemand, LiveDemandSchema } from './schemas/live-demand.schema';
import { LiveDemandService } from './services/live-demand.service';
import { LiveDemandResolver } from './resolvers/live-demand.resolver';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: EnergyBalance.name, schema: EnergyBalanceSchema },
      { name: Frontera.name, schema: FronteraSchema },
      // §3.40 — cache live (TTL 60s, ver `schemas/live-demand.schema.ts`).
      {
        name: LiveDemand.name,
        schema: LiveDemandSchema,
      },
      // §3.38 — registro del schema de cache histórico. Composite
      // unique key (region, date) + TTL 24h. Ver
      // `schemas/live-demand-historical.schema.ts` para rationale.
      {
        name: LiveDemandHistorical.name,
        schema: LiveDemandHistoricalSchema,
      },
    ]),
    HttpModule,
  ],
  providers: [
    EnergyBalanceService,
    ReeClientService,
    FronteraService,
    EnergyBalanceResolver,
    FronteraResolver,
    // §3.40 — ver bloque de imports arriba.
    LiveDemandService,
    LiveDemandResolver,
  ],
  exports: [EnergyBalanceService, ReeClientService, FronteraService],
  // §3.40 — `LiveDemandService` NO se exporta (YAGNI; ningún feature
  // module extra lo consume todavía). Si §3.41+ lo necesita, añadir.
})
export class EnergyBalanceModule {}
