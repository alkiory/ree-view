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
import { LiveDemand, LiveDemandSchema } from './schemas/live-demand.schema';
import { LiveDemandService } from './services/live-demand.service';
import { LiveDemandResolver } from './resolvers/live-demand.resolver';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: EnergyBalance.name, schema: EnergyBalanceSchema },
      { name: Frontera.name, schema: FronteraSchema },
      { name: LiveDemand.name, schema: LiveDemandSchema },
    ]),
    HttpModule,
  ],
  providers: [
    EnergyBalanceService,
    ReeClientService,
    FronteraService,
    LiveDemandService,
    EnergyBalanceResolver,
    FronteraResolver,
    LiveDemandResolver,
  ],
  exports: [
    EnergyBalanceService,
    ReeClientService,
    FronteraService,
    LiveDemandService,
  ],
})
export class EnergyBalanceModule {}
