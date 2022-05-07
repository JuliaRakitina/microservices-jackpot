import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { JackpotController } from './jackpot.controller';
import { JackpotService } from './jackpot.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Jackpot } from './jackpot.entity';
import { USER_PACKAGE_NAME, USER_SERVICE_NAME } from './proto/user.pb';

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
    TypeOrmModule.forFeature([Jackpot]),
  ],
  controllers: [JackpotController],
  providers: [JackpotService],
})
export class JackpotModule {}
