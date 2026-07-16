import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  // Validación declarativa para DTOs anotados con class-validator.
  // whitelist: true elimina propiedades no declaradas en el DTO
  //   (defensa contra inyección de campos no esperados)
  // forbidNonWhitelisted: false → no rechaza la petición, solo sanea
  // transform: true → castea los args de GraphQL a instancias del DTO
  //              (necesario para que las decoraciones funcionen)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
      transformOptions: { enableImplicitConversion: false },
      stopAtFirstError: false,
    }),
  );

  // CORS seguro: lista blanca de orígenes configurable vía env.
  // En desarrollo el frontend Vite corre en http://localhost:5173
  // y en Docker se sirve bajo http://localhost:80. El sandbox de Apollo
  // Server 4 (embedded UI, self-hosted) responde same-origin → no requiere
  // nada extra, pero un dev que manualmente abra `http://localhost:3000/graphql`
  // desde el navegador dispara peticiones con `Origin: http://localhost:3000`,
  // por lo que lo añadimos para que funcione en inspección manual.
  // `https://studio.apollographql.com` queda en la allowlist porque Apollo
  // Studio (cloud-hosted inspector) sigue siendo utilizable con el plugin
  // `ApolloServerPluginLandingPageProductionDefault` instalado en
  // `app.module.ts` — ese plugin apaga la Sandbox local self-hosted en
  // producción pero NO bloquea conexiones externas desde Apollo Studio.
  // Usamos `||` (no `??`) para que un valor vacío o solo-whitespace caiga al default;
  // un `CORS_ORIGINS=""` mal seteado no debe terminar bloqueando toda petición.
  //
  // ⚠️ Dev-only: estos defaults NO deberían estar permitidos en producción.
  // Cuando `NODE_ENV === 'production'`, defaultOrigins se vacía para forzar
  // a que `CORS_ORIGINS` esté explícitamente configurado. Caveat: este check
  // depende de que el operador setee NODE_ENV=production explícitamente
  // (systemd/PM2/Docker no lo hacen por default). Mejorable con un guard de
  // ConfigSchema cuando se introduzca validación de env (ver CURRENT.md §6).
  const isProd = process.env.NODE_ENV === 'production';
  const defaultOrigins = isProd
    ? ''
    : 'http://localhost:5173,http://localhost:80,http://localhost:3000,https://studio.apollographql.com';
  const allowedOrigins = (process.env.CORS_ORIGINS || defaultOrigins)
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  if (allowedOrigins.length === 0) {
    console.warn(
      '[CORS] No hay orígenes configurados. Ninguna petición cross-origin será aceptada.',
    );
  }

  app.enableCors({
    origin: (origin, callback) => {
      // Permitir peticiones sin origen (curl, server-side, GraphQL Playground)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`Origin ${origin} not allowed by CORS`), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
  });

  await app.listen(Number(process.env.PORT) || 3000);
  const url = await app.getUrl();
  console.log(`Application is running on: ${url}`);
  console.log(`GraphQL Playground is available at: ${url}/graphql`);
  console.log(`CORS allowed origins: ${allowedOrigins.join(', ')}`);
}
bootstrap();
