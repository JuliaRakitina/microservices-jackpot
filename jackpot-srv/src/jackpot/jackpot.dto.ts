import { IsNumber } from 'class-validator';
import {
  AddJackpotAmountRequest,
  CreateJackpotRequest,
  DeleteJackpotRequest,
  RunJackpotRequest,
  StopActiveJackpotRequest,
  WithdrawFromJackpotRequest,
  GetJackpotByIdRequest,
} from './proto/jackpot.pb';

export class CreateJackpotRequestDto implements CreateJackpotRequest {
  @IsNumber()
  public seed: number;
}

export class AddJackpotAmountRequestDto implements AddJackpotAmountRequest {
  @IsNumber()
  public id: number;

  @IsNumber()
  public amount: number;
}

export class StopActiveJackpotRequestDto implements StopActiveJackpotRequest {
  @IsNumber()
  public id: number;
}

export class RunJackpotRequestDto implements RunJackpotRequest {
  @IsNumber()
  public id: number;
}

export class GetJackpotByIdRequestDto implements GetJackpotByIdRequest {
  @IsNumber()
  public id: number;
}

export class DeleteJackpotRequestDto implements DeleteJackpotRequest {
  @IsNumber()
  public id: number;
}

export class WithdrawFromJackpotRequestDto
  implements WithdrawFromJackpotRequest
{
  @IsNumber()
  public id: number;

  @IsNumber()
  public userId: number;

  @IsNumber()
  public amount: number;
}
