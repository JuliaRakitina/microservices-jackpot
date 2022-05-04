import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { JackpotModule } from './jackpot/jackpot.module';

@Module({
  imports: [JackpotModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
