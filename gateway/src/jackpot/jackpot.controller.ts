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
} from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { Observable, of } from 'rxjs';
import {
  JACKPOT_SERVICE_NAME,
  JackpotServiceClient,
  CreateJackpotRequest,
  CreateJackpotResponse,
} from './jackpot.pb';
import { AuthGuard } from '../auth/auth.guard';
import { Request } from 'express';

@Controller('jackpot')
export class JackpotController implements OnModuleInit {
  private svc: JackpotServiceClient;

  @Inject(JACKPOT_SERVICE_NAME)
  private readonly client: ClientGrpc;

  public onModuleInit(): void {
    this.svc =
      this.client.getService<JackpotServiceClient>(JACKPOT_SERVICE_NAME);
  }

  @Get('test')
  private async testJackpot(): Promise<Observable<any>> {
    return this.svc.testJackpot({});
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
}
