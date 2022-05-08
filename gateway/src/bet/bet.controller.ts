import { Controller, Inject, OnModuleInit } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { BET_SERVICE_NAME, BetServiceClient } from './bet.pb';

@Controller('bet')
export class BetController implements OnModuleInit {
  private svc: BetServiceClient;

  @Inject(BET_SERVICE_NAME)
  private readonly client: ClientGrpc;

  public onModuleInit(): void {
    this.svc = this.client.getService<BetServiceClient>(BET_SERVICE_NAME);
  }
}
