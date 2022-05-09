import { HttpStatus, Inject, Injectable, OnModuleInit } from '@nestjs/common';
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
  WithdrawFromJackpotRequest,
  WithdrawFromJackpotResponse,
  GetJackpotByIdResponse,
} from './proto/jackpot.pb';
import { STATUSES } from './utils';
import { GetJackpotByIdRequestDto } from './jackpot.dto';
import { BET_SERVICE_NAME, BetServiceClient } from './proto/bet.pb';
import { ClientGrpc } from '@nestjs/microservices';
import { USER_SERVICE_NAME, UserServiceClient } from './proto/user.pb';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class JackpotService implements OnModuleInit {
  @InjectRepository(Jackpot)
  private readonly repository: Repository<Jackpot>;

  @Inject(BET_SERVICE_NAME)
  private readonly betClient: ClientGrpc;
  private betSvc: BetServiceClient;

  @Inject(USER_SERVICE_NAME)
  private readonly userClient: ClientGrpc;
  private userSvc: UserServiceClient;

  public onModuleInit(): void {
    this.betSvc = this.betClient.getService<BetServiceClient>(BET_SERVICE_NAME);
    this.userSvc =
      this.userClient.getService<UserServiceClient>(USER_SERVICE_NAME);
  }

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

    await this.repository.save(jackpot);

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
        status: HttpStatus.NOT_ACCEPTABLE,
      };
    }
    if (jackpot.amount < amount) {
      return {
        error: ['Not sufficient funds'],
        status: HttpStatus.NOT_ACCEPTABLE,
      };
    }

    const winner = await firstValueFrom(
      this.betSvc.getJackpotWinner({ jackpotId: jackpot.id }),
    );

    if (winner.userId === userId) {
      jackpot.amount = jackpot.amount - amount;
      const updatedUserBalance = await firstValueFrom(
        this.userSvc.updateUserBalance({ userId, operation: 'add', amount }),
      );
      await this.repository.save(jackpot);
      if (updatedUserBalance.status == HttpStatus.OK) {
        return {
          error: [null],
          status: HttpStatus.OK,
        };
      }
    } else {
      return {
        error: ['You are not a winner'],
        status: HttpStatus.NOT_ACCEPTABLE,
      };
    }

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

  public async getJackpotById({
    id,
  }: GetJackpotByIdRequestDto): Promise<GetJackpotByIdResponse> {
    const jackpot: Jackpot = await this.repository.findOne({ where: { id } });

    if (!jackpot) {
      return {
        error: ['Jackpot not found'],
        status: HttpStatus.NOT_FOUND,
        data: null,
      };
    }
    return { data: jackpot, error: null, status: HttpStatus.OK };
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

  private randomIntFromInterval(min, max) {
    return Math.floor(Math.random() * (max - min + 1) + min);
  }
}
