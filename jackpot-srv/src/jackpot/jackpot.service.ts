import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Jackpot } from './jackpot.entity';
import {
  AddJackpotAmountRequest,
  AddJackpotAmountResponse,
  CreateJackpotRequest,
  CreateJackpotResponse,
  ListAllJackpotsRequest,
  ListAllJackpotsResponse,
  RunJackpotRequest,
  RunJackpotResponse,
  StopActiveJackpotRequest,
  StopActiveJackpotResponse,
  TestJackpotResponse,
  WithdrawFromJackpotRequest,
  WithdrawFromJackpotResponse,
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

  public async addJackpotAmount({
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

  public async withdrawFromJackpot({
    id,
    amount,
    userId,
  }: WithdrawFromJackpotRequest): Promise<WithdrawFromJackpotResponse> {
    const jackpot: Jackpot = await this.repository.findOne({ where: { id } });

    if (!jackpot) {
      return {
        error: ['Jackpot not found'],
        status: HttpStatus.NOT_FOUND,
      };
    }
    if (jackpot.status != STATUSES.WON) {
      return {
        error: ['Jackpot is not won'],
        status: HttpStatus.NOT_FOUND,
      };
    }
    jackpot.amount = jackpot.amount - amount;
    //TODO check USERid
    const newJackpot = await this.repository.save(jackpot);
    if (newJackpot) {
    } else {
    }

    return {
      error: null,
      status: HttpStatus.OK,
    };
  }

  public async listAllJackpots(
    request: ListAllJackpotsRequest,
  ): Promise<ListAllJackpotsResponse> {
    const jackpots: Jackpot[] = await this.repository.find();

    return { data: jackpots, error: null, status: HttpStatus.OK };
  }

  public async runJackpot({
    id,
  }: RunJackpotRequest): Promise<RunJackpotResponse> {
    const jackpot: Jackpot = await this.repository.findOne({ where: { id } });

    if (!jackpot) {
      return {
        error: ['Jackpot not found'],
        status: HttpStatus.NOT_FOUND,
      };
    }
    if (jackpot.status == STATUSES.ACTIVE) {
      return {
        error: ['Jackpot is already active'],
        status: HttpStatus.NOT_FOUND,
      };
    }
    jackpot.status = STATUSES.ACTIVE;
    await this.repository.save(jackpot);
    return { error: null, status: HttpStatus.OK };
  }

  public async stopActiveJackpot({
    id,
  }: StopActiveJackpotRequest): Promise<StopActiveJackpotResponse> {
    const jackpot: Jackpot = await this.repository.findOne({ where: { id } });

    if (!jackpot) {
      return {
        error: ['Jackpot not found'],
        status: HttpStatus.NOT_FOUND,
      };
    }
    if (jackpot.status !== STATUSES.ACTIVE) {
      return {
        error: ['Jackpot is not active'],
        status: HttpStatus.NOT_FOUND,
      };
    }
    jackpot.status = STATUSES.FINISHED;
    await this.repository.save(jackpot);
    return { error: null, status: HttpStatus.OK };
  }

  public testJackpot(): Promise<TestJackpotResponse> {
    return Promise.resolve({ status: 200 });
  }

  private randomIntFromInterval(min, max) {
    return Math.floor(Math.random() * (max - min + 1) + min);
  }
}
