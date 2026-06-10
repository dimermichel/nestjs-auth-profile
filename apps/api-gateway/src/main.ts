import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';

const REQUIRED_ENV = ['JWT_SECRET', 'REDIS_URL', 'AUTH_SERVICE_URL', 'PROFILE_SERVICE_URL'];

function assertEnv() {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  assertEnv();
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  logger.log(`API Gateway running on port ${port}`);
}
void bootstrap();
