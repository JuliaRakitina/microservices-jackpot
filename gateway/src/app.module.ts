import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { JackpotModule } from './jackpot/jackpot.module';

@Module({
  imports: [AuthModule, UserModule, JackpotModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
