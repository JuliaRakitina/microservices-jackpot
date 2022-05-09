import { HttpStatus, Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { Bet } from './bet.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JACKPOT_SERVICE_NAME, JackpotServiceClient } from './proto/jackpot.pb';
import { ClientGrpc } from '@nestjs/microservices';
import { USER_SERVICE_NAME, UserServiceClient } from './proto/user.pb';
import {
  GetBetsByUserIdRequestDto,
  GetJackpotBetsInfoByIdRequestDto,
  GetJackpotWinnerRequestDto,
  GetWonBetsByUserIdRequestDto,
  MakeBetRequestDto,
} from './bet.dto';
import {
  BetData,
  GetBetsByUserIdResponse,
  GetJackpotBetsInfoByIdResponse,
  GetJackpotWinnerResponse,
  GetWonBetsByUserIdResponse,
  MakeBetResponse,
} from './proto/bet.pb';
import { firstValueFrom } from 'rxjs';
import { STATUSES } from './utils';

@Injectable()
export class BetService implements OnModuleInit {
  @InjectRepository(Bet)
  private readonly repository: Repository<Bet>;

  @Inject(JACKPOT_SERVICE_NAME)
  private readonly jackpotClient: ClientGrpc;
  private jackpotSvc: JackpotServiceClient;

  @Inject(USER_SERVICE_NAME)
  private readonly userClient: ClientGrpc;
  private userSvc: UserServiceClient;

  public onModuleInit(): void {
    this.jackpotSvc =
      this.jackpotClient.getService<JackpotServiceClient>(JACKPOT_SERVICE_NAME);
    this.userSvc =
      this.userClient.getService<UserServiceClient>(USER_SERVICE_NAME);
  }

  public async makeBet({
    userId,
    jackpotId,
    bet,
  }: MakeBetRequestDto): Promise<MakeBetResponse> {
    const betPlaced = await firstValueFrom(
      this.jackpotSvc.addJackpotAmount({ id: jackpotId, amount: bet }),
    );

    if (betPlaced.status === HttpStatus.OK) {
      const newBet = {
        userId,
        jackpotId,
        bet,
        status: betPlaced.isWon ? 'won' : 'slip',
      };
      const betSaved = await this.repository.save(newBet);
      return { data: betSaved as BetData, error: null, status: HttpStatus.OK };
    } else {
      return {
        data: undefined,
        error: betPlaced.error,
        status: HttpStatus.INTERNAL_SERVER_ERROR,
      };
    }
  }

  public async getJackpotBetsInfoById({
    id,
  }: GetJackpotBetsInfoByIdRequestDto): Promise<GetJackpotBetsInfoByIdResponse> {
    const bets: Bet[] = await this.repository.find({
      where: { jackpotId: id },
    });
    if (bets.length > 0) {
      return {
        data: bets,
        error: null,
        status: HttpStatus.OK,
      };
    }
    return {
      data: undefined,
      error: ['Something went wrong'],
      status: HttpStatus.INTERNAL_SERVER_ERROR,
    };
  }

  public async getJackpotWinner({
    jackpotId,
  }: GetJackpotWinnerRequestDto): Promise<GetJackpotWinnerResponse> {
    const bets: Bet[] = await this.repository.find({ where: { jackpotId } });
    const winner = bets.find((bet) => bet.status === STATUSES.WON);
    if (winner) {
      return {
        jackpotStatus: winner.status,
        userId: winner.userId,
        bet: winner.bet,
        error: null,
        status: HttpStatus.OK,
      };
    }
    return {
      jackpotStatus: null,
      userId: null,
      bet: null,
      error: ['Something went wrong'],
      status: HttpStatus.INTERNAL_SERVER_ERROR,
    };
  }

  public async getWonBetsByUserId({
    userId,
  }: GetWonBetsByUserIdRequestDto): Promise<GetWonBetsByUserIdResponse> {
    const bets: Bet[] = await this.repository.find({
      where: { userId, status: STATUSES.WON },
    });
    if (bets.length > 0) {
      return {
        data: bets,
        error: null,
        status: HttpStatus.OK,
      };
    }
    return {
      data: null,
      error: ['Something went wrong'],
      status: HttpStatus.INTERNAL_SERVER_ERROR,
    };
  }

  public async getBetsByUserId({
    userId,
  }: GetBetsByUserIdRequestDto): Promise<GetBetsByUserIdResponse> {
    const bets: Bet[] = await this.repository.find({
      where: { userId },
    });
    if (bets.length > 0) {
      return {
        data: bets,
        error: null,
        status: HttpStatus.OK,
      };
    }
    return {
      data: null,
      error: ['Something went wrong'],
      status: HttpStatus.INTERNAL_SERVER_ERROR,
    };
  }
}
