import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { join } from 'path';
import { INestMicroservice, ValidationPipe } from '@nestjs/common';
import { protobufPackage } from './jackpot/proto/jackpot.pb';
import { Transport } from '@nestjs/microservices';

async function bootstrap() {
  const app: INestMicroservice = await NestFactory.createMicroservice(
    AppModule,
    {
      transport: Transport.GRPC,
      options: {
        url: '0.0.0.0:50054',
        package: protobufPackage,
        protoPath: join('node_modules/rp-proto/proto/jackpot.proto'),
      },
    },
  );

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  await app.listen();
}
bootstrap();
