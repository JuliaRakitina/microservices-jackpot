import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BetModule } from './bet/bet.module';

@Module({
  imports: [BetModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
