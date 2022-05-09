import { Controller, Get, Inject, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { BET_SERVICE_NAME, BetServiceClient } from './bet.pb';
import { Observable } from 'rxjs';

@Controller('bet')
export class BetController implements OnModuleInit {
  private svc: BetServiceClient;

  @Inject(BET_SERVICE_NAME)
  private readonly client: ClientGrpc;

  public onModuleInit(): void {
    this.svc = this.client.getService<BetServiceClient>(BET_SERVICE_NAME);
  }

  @Get('test')
  private async test(): Promise<Observable<any>> {
    console.info(' JULIAAAAA');
    return this.svc.test({});
  }
}
