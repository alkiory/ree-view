import { Module, Logger } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { MongooseModule } from '@nestjs/mongoose';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver } from '@nestjs/apollo';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EnergyBalanceModule } from './energy-balance/energy-balance.module';
import { DebugController } from './energy-balance/energy-balance.controller';
import { GqlThrottlerGuard } from './common/guards/gql-throttler.guard';

// Límites configurables vía env (con defaults sensatos).
const THROTTLE_TTL_MS = Number(process.env.THROTTLE_TTL_MS) || 60_000;
const THROTTLE_LIMIT = Number(process.env.THROTTLE_LIMIT) || 30;

/**
 * Fallback de MONGODB_URI cuando el developer ejecuta `pnpm dev`
 * sin tener un backend/.env configurado. En Docker el compose lo
 * sobrescribe a `mongodb://mongo:27017/energy-balance`. En dev local
 * apunta a 27017 del host (que tiene Mongo local O accesible vía
 * docker-compose expose 27017:27017 añadido en este mismo tier).
 */
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
        // Oculto credenciales si las hubiera en la URI al imprimir el log.
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
      // Exponer req/res en el contexto GraphQL es **obligatorio** para que
      // el GqlThrottlerGuard (APP_GUARD global) pueda leer `req.ip` y aplicar
      // el rate-limit correctamente sobre los resolvers.
      context: ({ req, res }) => ({ req, res }),
    }),
  ],
  controllers: [AppController, DebugController],
  providers: [
    AppService,
    // APP_GUARD aplica el rate-limiter a TODA petición entrante
    // (incluso resolvers GraphQL gracias al extractor de contexto).
    {
      provide: APP_GUARD,
      useClass: GqlThrottlerGuard,
    },
  ],
})
export class AppModule {}
