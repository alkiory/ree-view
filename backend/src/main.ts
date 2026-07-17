import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
      transformOptions: { enableImplicitConversion: false },
      stopAtFirstError: false,
    }),
  );

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
