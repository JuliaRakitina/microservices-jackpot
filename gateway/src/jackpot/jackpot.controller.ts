import {
  Controller,
  Inject,
  OnModuleInit,
  UseGuards,
  Post,
  Body,
} from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { Observable } from 'rxjs';
import { AuthGuard } from '../auth/auth.guard';
import {
  CreateJackpotRequest,
  CreateJackpotResponse,
  JACKPOT_SERVICE_NAME,
  JackpotServiceClient,
} from './jackpot.pb';

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
    @Body() body: CreateJackpotRequest,
  ): Promise<Observable<CreateJackpotResponse>> {
    return this.svc.createJackpot(body);
  }

  // @Get(':id')
  // @UseGuards(AuthGuard)
  // private async findOne(@Param('id', ParseIntPipe) id: number): Promise<Observable<FindOneResponse>> {
  //     return this.svc.findOne({ id });
  // }
}
