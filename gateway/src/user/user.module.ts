import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { USER_SERVICE_NAME, USER_PACKAGE_NAME } from './user.pb';
import { UserController } from './user.controller';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: USER_SERVICE_NAME,
        transport: Transport.GRPC,
        options: {
          url: '0.0.0.0:50052',
          package: USER_PACKAGE_NAME,
          protoPath: 'node_modules/rp-proto/proto/user.proto',
        },
      },
    ]),
  ],
  controllers: [UserController],
})
export class UserModule {}
