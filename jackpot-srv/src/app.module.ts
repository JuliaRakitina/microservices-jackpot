import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { JackpotModule } from './jackpot/jackpot.module';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: 'red-pocket-postgres',
      // host: 'localhost',
      port: 5432,
      database: 'micro_jackpot',
      username: 'postgres',
      password: 'postgres',
      entities: ['dist/**/*.entity.{ts,js}'],
      synchronize: true, // never true in production!
    }),
    JackpotModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
