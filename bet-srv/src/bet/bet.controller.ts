import { Controller, Inject } from '@nestjs/common';
import { BetService } from './bet.service';
import { GrpcMethod } from '@nestjs/microservices';
import { BET_SERVICE_NAME, TestResponse } from './proto/bet.pb';
import { Observable } from 'rxjs';

@Controller('bet')
export class BetController {
  @Inject(BetService)
  private readonly service: BetService;

  @GrpcMethod(BET_SERVICE_NAME, 'Test')
  private async test(): Promise<Observable<TestResponse>> {
    console.info(' GOT YOU');
    return this.service.test();
  }
}
