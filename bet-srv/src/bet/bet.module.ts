import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { BetController } from './bet.controller';
import { BetService } from './bet.service';
import { Bet } from './bet.entity';
import { USER_PACKAGE_NAME, USER_SERVICE_NAME } from './proto/user.pb';
import { JACKPOT_PACKAGE_NAME, JACKPOT_SERVICE_NAME } from './proto/jackpot.pb';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: USER_SERVICE_NAME,
        transport: Transport.GRPC,
        options: {
          url: 'red-pocket-user-srv:50053',
          package: USER_PACKAGE_NAME,
          protoPath: 'node_modules/rp-proto/proto/user.proto',
        },
      },
    ]),
    ClientsModule.register([
      {
        name: JACKPOT_SERVICE_NAME,
        transport: Transport.GRPC,
        options: {
          url: 'red-pocket-jackpot-srv:50054',
          package: JACKPOT_PACKAGE_NAME,
          protoPath: 'node_modules/rp-proto/proto/jackpot.proto',
        },
      },
    ]),
    TypeOrmModule.forFeature([Bet]),
  ],
  controllers: [BetController],
  providers: [BetService],
})
export class BetModule {}
