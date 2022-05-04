import { Module } from '@nestjs/common';
import { JackpotController } from './jackpot.controller';

@Module({
  controllers: [JackpotController]
})
export class JackpotModule {}
