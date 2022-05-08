import { HttpStatus, Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { Bet } from './bet.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JACKPOT_SERVICE_NAME, JackpotServiceClient } from './proto/jackpot.pb';
import { ClientGrpc } from '@nestjs/microservices';
import { USER_SERVICE_NAME, UserServiceClient } from './proto/user.pb';
import { MakeBetRequestDto } from './bet.dto';
import { BetData, MakeBetResponse } from './proto/bet.pb';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class BetService implements OnModuleInit {
  @InjectRepository(Bet)
  private readonly repository: Repository<Bet>;
  private readonly client: ClientGrpc;

  @Inject(JACKPOT_SERVICE_NAME)
  private jackpotSvc: JackpotServiceClient;
  @Inject(USER_SERVICE_NAME)
  private userSvc: UserServiceClient;

  public onModuleInit(): void {
    this.jackpotSvc =
      this.client.getService<JackpotServiceClient>(JACKPOT_SERVICE_NAME);
    this.userSvc = this.client.getService<UserServiceClient>(USER_SERVICE_NAME);
  }

  public async makeBet({
    userId,
    jackpotId,
    bet,
  }: MakeBetRequestDto): Promise<MakeBetResponse> {
    const betPlaced = await firstValueFrom(
      this.jackpotSvc.addJackpotAmount({ id: jackpotId, amount: bet }),
    );

    if (betPlaced) {
      const newBet = {
        userId,
        jackpotId,
        status: betPlaced.isWon ? 'won' : 'slip',
      };
      const betSaved = await this.repository.save(newBet);
      return { data: betSaved as BetData, error: null, status: HttpStatus.OK };
    } else {
      return {
        data: undefined,
        error: ['Something went wrong'],
        status: HttpStatus.INTERNAL_SERVER_ERROR,
      };
    }
  }
}
