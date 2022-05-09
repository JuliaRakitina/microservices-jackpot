import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Inject,
  OnModuleInit,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import {
  BET_SERVICE_NAME,
  BetServiceClient,
  MakeBetResponse,
  GetJackpotBetsInfoByIdRequest,
  GetJackpotBetsInfoByIdResponse,
  GetBetsByUserIdRequest,
  GetBetsByUserIdResponse,
  GetJackpotWinnerResponse,
  GetJackpotWinnerRequest, MakeBetRequest,
} from './bet.pb';
import { Observable, of } from 'rxjs';
import { AuthGuard } from '../auth/auth.guard';
import { Request } from 'express';

export interface IMakeBetRequest {
  jackpotId: number;
  bet: number;
}

@Controller('bet')
export class BetController implements OnModuleInit {
  private svc: BetServiceClient;

  @Inject(BET_SERVICE_NAME)
  private readonly client: ClientGrpc;

  public onModuleInit(): void {
    this.svc = this.client.getService<BetServiceClient>(BET_SERVICE_NAME);
  }

  @Post()
  @UseGuards(AuthGuard)
  private async makeBet(
    @Req() req: Request,
    @Body() body: IMakeBetRequest,
  ): Promise<Observable<MakeBetResponse>> {
    if (req['role'] === 'player') {
      const data = { ...body, userId: req['userId'] } as MakeBetRequest;
      return this.svc.makeBet(data);
    } else {
      return of({
        status: HttpStatus.FORBIDDEN,
        error: ['You should be player to make a bet'],
        data: null,
      });
    }
  }

  @Get('getJackpotBetsInfoById')
  @UseGuards(AuthGuard)
  private async getJackpotBetsInfoById(
    @Req() req: Request,
    @Body() body: GetJackpotBetsInfoByIdRequest,
  ): Promise<Observable<GetJackpotBetsInfoByIdResponse>> {
    if (req['role'] === 'admin') {
      return this.svc.getJackpotBetsInfoById(body);
    } else {
      return of({
        status: HttpStatus.FORBIDDEN,
        error: ['Insufficient rights'],
        data: null,
      });
    }
  }

  @Get('getBetsByUserId')
  @UseGuards(AuthGuard)
  private async getBetsByUserId(
    @Req() req: Request,
    @Body() body: GetBetsByUserIdRequest,
  ): Promise<Observable<GetBetsByUserIdResponse>> {
    if (req['role'] === 'admin') {
      return this.svc.getBetsByUserId(body);
    } else {
      return of({
        status: HttpStatus.FORBIDDEN,
        error: ['Insufficient rights'],
        data: null,
      });
    }
  }

  @Get('getJackpotWinner')
  @UseGuards(AuthGuard)
  private async getJackpotWinner(
    @Req() req: Request,
    @Body() body: GetJackpotWinnerRequest,
  ): Promise<Observable<GetJackpotWinnerResponse>> {
    if (req['role'] === 'admin') {
      return this.svc.getJackpotWinner(body);
    } else {
      return of({
        status: HttpStatus.FORBIDDEN,
        error: ['Insufficient rights'],
        jackpotStatus: null,
        userId: null,
        bet: null,
      });
    }
  }
}
