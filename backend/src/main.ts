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
  // y en Docker se sirve bajo http://localhost:80.
  // Usamos `||` (no `??`) para que un valor vacío o solo-whitespace caiga al default;
  // un `CORS_ORIGINS=""` mal seteado no debe terminar bloqueando toda petición.
  const defaultOrigins = 'http://localhost:5173,http://localhost:80';
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
