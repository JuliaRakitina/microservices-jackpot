import { Controller, Inject } from '@nestjs/common';
import { BetService } from './bet.service';
import { GrpcMethod } from '@nestjs/microservices';
import {
  BET_SERVICE_NAME,
  GetBetsByUserIdResponse,
  GetJackpotBetsInfoByIdResponse,
  GetJackpotWinnerResponse,
  GetWonBetsByUserIdResponse,
  MakeBetResponse,
} from './proto/bet.pb';
import {
  GetBetsByUserIdRequestDto,
  GetJackpotBetsInfoByIdRequestDto,
  GetJackpotWinnerRequestDto,
  GetWonBetsByUserIdRequestDto,
  MakeBetRequestDto,
} from './bet.dto';

@Controller('bet')
export class BetController {
  @Inject(BetService)
  private readonly service: BetService;

  @GrpcMethod(BET_SERVICE_NAME, 'MakeBet')
  private async makeBet(data: MakeBetRequestDto): Promise<MakeBetResponse> {
    return this.service.makeBet(data);
  }

  @GrpcMethod(BET_SERVICE_NAME, 'GetBetsByUserId')
  private async getBetsByUserId(
    data: GetBetsByUserIdRequestDto,
  ): Promise<GetBetsByUserIdResponse> {
    return this.service.getBetsByUserId(data);
  }

  @GrpcMethod(BET_SERVICE_NAME, 'GetJackpotBetsInfoById')
  private async getJackpotBetsInfoById(
    data: GetJackpotBetsInfoByIdRequestDto,
  ): Promise<GetJackpotBetsInfoByIdResponse> {
    return this.service.getJackpotBetsInfoById(data);
  }

  @GrpcMethod(BET_SERVICE_NAME, 'GetJackpotWinner')
  private async getJackpotWinner(
    data: GetJackpotWinnerRequestDto,
  ): Promise<GetJackpotWinnerResponse> {
    return this.service.getJackpotWinner(data);
  }

  @GrpcMethod(BET_SERVICE_NAME, 'GetWonBetsByUserId')
  private async getWonBetsByUserId(
    data: GetWonBetsByUserIdRequestDto,
  ): Promise<GetWonBetsByUserIdResponse> {
    return this.service.getWonBetsByUserId(data);
  }
}
