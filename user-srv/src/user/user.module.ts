import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { User } from './user.entity';
import { AUTH_PACKAGE_NAME, AUTH_SERVICE_NAME } from './proto/auth.pb';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: AUTH_SERVICE_NAME,
        transport: Transport.GRPC,
        options: {
          url: 'red-pocket-auth-srv:50051',
          // url: 'localhost:50051',
          package: AUTH_PACKAGE_NAME,
          protoPath: 'node_modules/rp-proto/proto/auth.proto',
        },
      },
    ]),
    TypeOrmModule.forFeature([User]),
  ],
  controllers: [UserController],
  providers: [UserService],
})
export class UserModule {}
