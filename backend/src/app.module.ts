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
      // Por qué `playground: false` es OBLIGATORIO en este @nestjs/apollo@12:
      //   `apollo-base.driver.js:mergeDefaultOptions` auto-inyecta
      //   `ApolloServerPluginLandingPageGraphQLPlayground` (un plugin v3
      //   leftover que implementa `renderLandingPage`) cuando
      //   `playground === undefined && NODE_ENV !== 'production'`. Si lo
      //   dejamos así y además añadimos cualquier plugin que también
      //   implemente `renderLandingPage`, Apollo Server 4 lanza
      //   `'Only one plugin can implement renderLandingPage.'`
      //   desde `ApolloServer.ts:492`.
      //
      //   Con `playground: false` la rama del else-if se activa e
      //   inyecta `ApolloServerPluginLandingPageDisabled()`, un
      //   **marker plugin SIN `renderLandingPage`** (sólo expone
      //   `__internal_plugin_id__: 'LandingPageDisabled'`). Apollo ve
      //   ese marker y SKIP su auto-install default (ApolloServer.ts:1018
      //   `alreadyHavePluginWithInternalId('LandingPageDisabled')`). El
      //   resultado: cero landing-page auto-installed, y nuestro plugin
      //   único en `plugins: [...]` queda como el único con
      //   `renderLandingPage`.
      playground: false,
      // Exponer req/res en el contexto GraphQL es **obligatorio** para que
      // el GqlThrottlerGuard (APP_GUARD global) pueda leer `req.ip` y aplicar
      // el rate-limit correctamente sobre los resolvers.
      context: ({ req, res }) => ({ req, res }),
      plugins: [
        // Conditional swap por NODE_ENV. Apollo Server 4 usa internamente
        // `nodeEnv !== 'production'` (ApolloServer.ts:215) para discernir
        // dev/prod — gateamos con el mismo check para no introducir drift.
        //
        // Dev (no-production) → ApolloServerPluginLandingPageLocalDefault
        //   Implementa `isProd: false`. `embed: true` es default interno
        //   (`default/index.ts:32`). Renderiza Apollo Sandbox HTML
        //   (getEmbeddedSandboxHTML). Es lo que se quiere para el workflow
        //   `pnpm start:dev` actual.
        //
        // Production → ApolloServerPluginLandingPageProductionDefault
        //   Implementa `isProd: true`. NO pasamos `embed` → cae al branch
        //   `getNonEmbeddedLandingPageHTML` (`default/index.ts:170`), que
        //   NO es Sandbox — es la landing minimal "Welcome to Apollo
        //   Server" sin UI de queries. Si en el futuro queremos literalmente
        //   NADA en prod (recommended for prod hardened), cambiar a
        //   `ApolloServerPluginLandingPageDisabled()` (que ya está auto-
        //   injected por Nest gracias a `playground: false`).
        //
        // Caveat: la detección es literal `NODE_ENV === 'production'`.
        // `'staging'` cae en dev (Sandbox visible). Comportamiento estándar
        // y aceptable; si staging/pre-prod necesitan endurecerse, añadir
        // un allowlist explícito en lugar de `$eq`.
        //
        // Resuelve agent-memory/CURRENT.md §6 TODO #4 con verificación
        // runtime dual (dev + prod servidos al puerto 3000).
        process.env.NODE_ENV === 'production'
          ? ApolloServerPluginLandingPageProductionDefault()
          : ApolloServerPluginLandingPageLocalDefault(),
      ],
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
