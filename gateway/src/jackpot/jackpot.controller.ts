import {
  Controller,
  Inject,
  OnModuleInit,
  Get,
  Post,
  UseGuards,
  Req,
  Body,
  HttpStatus,
  Delete,
} from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { Observable, of } from 'rxjs';
import {
  JACKPOT_SERVICE_NAME,
  JackpotServiceClient,
  CreateJackpotRequest,
  CreateJackpotResponse,
  RunJackpotRequest,
  RunJackpotResponse,
  StopActiveJackpotRequest,
  StopActiveJackpotResponse,
  ListAllJackpotsRequest,
  ListAllJackpotsResponse,
  DeleteJackpotRequest,
  DeleteJackpotResponse,
  GetJackpotByIdRequest,
  GetJackpotByIdResponse,
  WithdrawFromJackpotResponse,
  WithdrawFromJackpotRequest,
} from './jackpot.pb';
import { AuthGuard } from '../auth/auth.guard';
import { Request } from 'express';
import { MakeBetRequest } from '../bet/bet.pb';

export interface IWithdrawFromJackpotRequest {
  id: number;
  amount: number;
}

@Controller('jackpot')
export class JackpotController implements OnModuleInit {
  private svc: JackpotServiceClient;

  @Inject(JACKPOT_SERVICE_NAME)
  private readonly client: ClientGrpc;

  public onModuleInit(): void {
    this.svc =
      this.client.getService<JackpotServiceClient>(JACKPOT_SERVICE_NAME);
  }

  @Post()
  @UseGuards(AuthGuard)
  private async createJackpot(
    @Req() req: Request,
    @Body() body: CreateJackpotRequest,
  ): Promise<Observable<CreateJackpotResponse>> {
    if (req['role'] === 'admin') {
      return this.svc.createJackpot(body);
    } else {
      return of({
        status: HttpStatus.FORBIDDEN,
        error: ['Insufficient rights'],
        id: null,
      });
    }
  }

  @Post('run')
  @UseGuards(AuthGuard)
  private async runJackpot(
    @Req() req: Request,
    @Body() body: RunJackpotRequest,
  ): Promise<Observable<RunJackpotResponse>> {
    if (req['role'] === 'admin') {
      return this.svc.runJackpot(body);
    } else {
      return of({
        status: HttpStatus.FORBIDDEN,
        error: ['Insufficient rights'],
      });
    }
  }

  @Post('stop')
  @UseGuards(AuthGuard)
  private async stopActiveJackpot(
    @Req() req: Request,
    @Body() body: StopActiveJackpotRequest,
  ): Promise<Observable<StopActiveJackpotResponse>> {
    if (req['role'] === 'admin') {
      return this.svc.stopActiveJackpot(body);
    } else {
      return of({
        status: HttpStatus.FORBIDDEN,
        error: ['Insufficient rights'],
      });
    }
  }

  @Get()
  @UseGuards(AuthGuard)
  private async listAllJackpots(
    @Req() req: Request,
    @Body() body: ListAllJackpotsRequest,
  ): Promise<Observable<ListAllJackpotsResponse>> {
    if (req['role'] === 'admin') {
      return this.svc.listAllJackpots(body);
    } else {
      return of({
        status: HttpStatus.FORBIDDEN,
        error: ['Insufficient rights'],
        data: null,
      });
    }
  }

  @Get('getJackpotById')
  @UseGuards(AuthGuard)
  private async getJackpotById(
    @Req() req: Request,
    @Body() body: GetJackpotByIdRequest,
  ): Promise<Observable<GetJackpotByIdResponse>> {
    if (req['role'] === 'admin') {
      return this.svc.getJackpotById(body);
    } else {
      return of({
        status: HttpStatus.FORBIDDEN,
        error: ['Insufficient rights'],
        data: null,
      });
    }
  }

  @Post('withdraw')
  @UseGuards(AuthGuard)
  private async withdrawFromJackpot(
    @Req() req: Request,
    @Body() body: IWithdrawFromJackpotRequest,
  ): Promise<Observable<WithdrawFromJackpotResponse>> {
    if (req['role'] === 'player') {
      const data = {
        ...body,
        userId: req['userId'],
      } as WithdrawFromJackpotRequest;
      return this.svc.withdrawFromJackpot(data);
    } else {
      return of({
        status: HttpStatus.FORBIDDEN,
        error: ['You can withdraw only as player'],
        data: null,
      });
    }
  }
}
