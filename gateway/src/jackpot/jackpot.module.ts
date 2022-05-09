import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { JACKPOT_PACKAGE_NAME, JACKPOT_SERVICE_NAME } from './jackpot.pb';
import { JackpotController } from './jackpot.controller';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: JACKPOT_SERVICE_NAME,
        transport: Transport.GRPC,
        options: {
          url: 'red-pocket-jackpot-srv:50054',
          // url: 'localhost:50054',
          package: JACKPOT_PACKAGE_NAME,
          protoPath: 'node_modules/rp-proto/proto/jackpot.proto',
        },
      },
    ]),
  ],
  controllers: [JackpotController],
})
export class JackpotModule {}
