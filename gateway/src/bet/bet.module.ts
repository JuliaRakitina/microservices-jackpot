import { Module } from '@nestjs/common';
import { BetController } from './bet.controller';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { BET_PACKAGE_NAME, BET_SERVICE_NAME } from './bet.pb';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: BET_SERVICE_NAME,
        transport: Transport.GRPC,
        options: {
          url: 'red-pocket-bet-srv:50052',
          // url: 'localhost:50052',
          package: BET_PACKAGE_NAME,
          protoPath: 'node_modules/rp-proto/proto/bet.proto',
        },
      },
    ]),
  ],
  controllers: [BetController],
})
export class BetModule {}
