import {
  Controller,
  Inject,
  OnModuleInit,
  UseGuards,
  Post,
  Body,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { Observable, of } from 'rxjs';
import { AuthGuard } from '../auth/auth.guard';
import {
  CreateJackpotRequest,
  CreateJackpotResponse,
  JACKPOT_SERVICE_NAME,
  JackpotServiceClient,
} from './jackpot.pb';
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

  // @Get(':id')
  // @UseGuards(AuthGuard)
  // private async findOne(@Param('id', ParseIntPipe) id: number): Promise<Observable<FindOneResponse>> {
  //     return this.svc.findOne({ id });
  // }
}
