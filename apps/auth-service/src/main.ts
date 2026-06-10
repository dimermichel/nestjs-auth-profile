import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { join } from 'path';
import { Logger, ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: 'auth',
      protoPath: join(process.cwd(), '../../libs/shared/src/proto/auth.proto'),
      url: `0.0.0.0:${process.env.GRPC_PORT ?? 5001}`,
    },
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix('api');

  await app.startAllMicroservices();

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  logger.log(`Auth service running on port ${port}`);
  logger.log(`gRPC listening on port ${process.env.GRPC_PORT ?? 5001}`);
}
void bootstrap();
