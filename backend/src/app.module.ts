import { Module, Logger } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { MongooseModule } from '@nestjs/mongoose';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver } from '@nestjs/apollo';
import {
  ApolloServerPluginLandingPageLocalDefault,
  ApolloServerPluginLandingPageProductionDefault,
} from '@apollo/server/plugin/landingPage/default';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EnergyBalanceModule } from './energy-balance/energy-balance.module';
import { DebugController } from './energy-balance/energy-balance.controller';
import { GqlThrottlerGuard } from './common/guards/gql-throttler.guard';

const THROTTLE_TTL_MS = Number(process.env.THROTTLE_TTL_MS) || 60_000;
const THROTTLE_LIMIT = Number(process.env.THROTTLE_LIMIT) || 30;

const DEFAULT_MONGO_URI = 'mongodb://localhost:27017/energy-balance';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const logger = new Logger('MongoConnection');
        const uri = config.get<string>('MONGODB_URI');
        if (!uri) {
          logger.warn(
            `MONGODB_URI no está definido en el entorno ni en .env. ` +
              `Usando fallback por defecto: ${DEFAULT_MONGO_URI}. ` +
              `Para producción define esta var explícitamente en .env o compose.`,
          );
          return { uri: DEFAULT_MONGO_URI };
        }
        logger.log(
          `Conectando a MongoDB: ${uri.replace(/\/\/[^@]+@/, '//***@')}`,
        );
        return { uri };
      },
    }),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: THROTTLE_TTL_MS,
        limit: THROTTLE_LIMIT,
      },
    ]),
    EnergyBalanceModule,
    GraphQLModule.forRoot({
      autoSchemaFile: true,
      driver: ApolloDriver,
      playground: false,
      context: ({ req, res }) => ({ req, res }),
      plugins: [
        process.env.NODE_ENV === 'production'
          ? ApolloServerPluginLandingPageProductionDefault()
          : ApolloServerPluginLandingPageLocalDefault(),
      ],
    }),
  ],
  controllers: [AppController, DebugController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: GqlThrottlerGuard,
    },
  ],
})
export class AppModule {}
