import { Module } from '@nestjs/common';
import { JackpotController } from './jackpot.controller';
import { JackpotService } from './jackpot.service';
import { Jackpot } from './jackpot.entity';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [TypeOrmModule.forFeature([Jackpot])],
  controllers: [JackpotController],
  providers: [JackpotService],
})
export class JackpotModule {}
