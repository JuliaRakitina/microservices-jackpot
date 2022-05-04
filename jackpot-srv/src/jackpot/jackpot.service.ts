import { HttpStatus, Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Jackpot } from './jackpot.entity';
import {
  AddJackpotAmountRequest,
  AddJackpotAmountResponse,
  CreateJackpotRequest,
  CreateJackpotResponse,
} from './proto/jackpot.pb';
import { STATUSES } from './utils';

@Injectable()
export class JackpotService {
  @InjectRepository(Jackpot)
  private readonly repository: Repository<Jackpot>;

  public async createJackpot({
    seed,
  }: CreateJackpotRequest): Promise<CreateJackpotResponse> {
    const jackpot: Jackpot = new Jackpot();

    jackpot.seed = seed;
    jackpot.amount = seed;
    jackpot.hitBy = this.randomIntFromInterval(0, seed);
    jackpot.status = STATUSES.CREATED;

    await this.repository.save(jackpot);

    return { id: jackpot.id, error: null, status: HttpStatus.OK };
  }

  public async AddJackpotAmount({
    id,
    amount,
  }: AddJackpotAmountRequest): Promise<AddJackpotAmountResponse> {
    const jackpot: Jackpot = await this.repository.findOne({ where: { id } });

    if (!jackpot) {
      return {
        id: undefined,
        amount: undefined,
        isWon: false,
        error: ['Jackpot not found'],
        status: HttpStatus.NOT_FOUND,
      };
    }
    if (jackpot.status != STATUSES.ACTIVE) {
      return {
        id: undefined,
        amount: undefined,
        isWon: false,
        error: ['Jackpot is not active'],
        status: HttpStatus.NOT_FOUND,
      };
    }

    const isWon = jackpot.hitBy < jackpot.amount - jackpot.seed;
    if (!isWon) {
      jackpot.amount = jackpot.amount + 0.1 * amount;
    } else {
      jackpot.status = STATUSES.WON;
    }

    return {
      id: jackpot.id,
      amount: jackpot.amount,
      isWon,
      error: null,
      status: HttpStatus.OK,
    };
  }

  private randomIntFromInterval(min, max) {
    return Math.floor(Math.random() * (max - min + 1) + min);
  }
}
