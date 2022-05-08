import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BetModule } from './bet/bet.module';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: 'red-pocket-postgres',
      port: 5432,
      database: 'micro_bet',
      username: 'postgres',
      password: 'postgres',
      entities: ['dist/**/*.entity.{ts,js}'],
      synchronize: true, // never true in production!
    }),
    BetModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
