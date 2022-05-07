import { Controller, Inject } from '@nestjs/common';
import { JackpotService } from './jackpot.service';
import { GrpcMethod } from '@nestjs/microservices';
import {
  AddJackpotAmountResponse,
  CreateJackpotResponse,
  JACKPOT_PACKAGE_NAME,
  ListAllJackpotsRequest,
  ListAllJackpotsResponse,
  RunJackpotResponse,
  StopActiveJackpotResponse,
  WithdrawFromJackpotResponse,
} from './proto/jackpot.pb';
import {
  AddJackpotAmountRequestDto,
  CreateJackpotRequestDto,
  RunJackpotRequestDto,
  StopActiveJackpotRequestDto,
  WithdrawFromJackpotRequestDto,
} from './jackpot.dto';

@Controller('jackpot')
export class JackpotController {
  @Inject(JackpotService)
  private readonly service: JackpotService;

  @GrpcMethod(JACKPOT_PACKAGE_NAME, 'CreateJackpot')
  private async createJackpot(
    data: CreateJackpotRequestDto,
  ): Promise<CreateJackpotResponse> {
    return this.service.createJackpot(data);
  }

  @GrpcMethod(JACKPOT_PACKAGE_NAME, 'AddJackpotAmount')
  private async addJackpotAmount(
    data: AddJackpotAmountRequestDto,
  ): Promise<AddJackpotAmountResponse> {
    return this.service.addJackpotAmount(data);
  }

  @GrpcMethod(JACKPOT_PACKAGE_NAME, 'WithdrawFromJackpot')
  private async withdrawFromJackpot(
    data: WithdrawFromJackpotRequestDto,
  ): Promise<WithdrawFromJackpotResponse> {
    return this.service.withdrawFromJackpot(data);
  }

  @GrpcMethod(JACKPOT_PACKAGE_NAME, 'ListAllJackpots')
  private async listAllJackpots(
    data: ListAllJackpotsRequest,
  ): Promise<ListAllJackpotsResponse> {
    return this.service.listAllJackpots(data);
  }

  @GrpcMethod(JACKPOT_PACKAGE_NAME, 'RunJackpot')
  private async runJackpot(
    data: RunJackpotRequestDto,
  ): Promise<RunJackpotResponse> {
    return this.service.runJackpot(data);
  }

  @GrpcMethod(JACKPOT_PACKAGE_NAME, 'StopActiveJackpot')
  private async stopActiveJackpot(
    data: StopActiveJackpotRequestDto,
  ): Promise<StopActiveJackpotResponse> {
    return this.service.stopActiveJackpot(data);
  }
}
