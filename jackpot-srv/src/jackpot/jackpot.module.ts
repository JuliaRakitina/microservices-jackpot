import { Module } from '@nestjs/common';
import { JackpotController } from './jackpot.controller';
import { JackpotService } from './jackpot.service';
import { Jackpot } from './jackpot.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { USER_PACKAGE_NAME, USER_SERVICE_NAME } from './proto/user.pb';
import { BET_PACKAGE_NAME, BET_SERVICE_NAME } from './proto/bet.pb';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: USER_SERVICE_NAME,
        transport: Transport.GRPC,
        options: {
          url: 'red-pocket-user-srv:50053',
          // url: 'localhost:50053',
          package: USER_PACKAGE_NAME,
          protoPath: 'node_modules/rp-proto/proto/user.proto',
        },
      },
    ]),
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
    TypeOrmModule.forFeature([Jackpot]),
  ],
  controllers: [JackpotController],
  providers: [JackpotService],
})
export class JackpotModule {}
