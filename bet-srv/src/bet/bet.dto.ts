import { IsNumber, Min } from 'class-validator';
import {
  GetBetsByUserIdRequest,
  GetJackpotBetsInfoByIdRequest,
  GetJackpotWinnerRequest,
  GetWonBetsByUserIdRequest,
  MakeBetRequest,
} from './proto/bet.pb';

export class MakeBetRequestDto implements MakeBetRequest {
  @IsNumber()
  public userId: number;

  @IsNumber()
  public jackpotId: number;

  @IsNumber()
  @Min(1)
  public bet: number;
}

export class GetBetsByUserIdRequestDto implements GetBetsByUserIdRequest {
  @IsNumber()
  public userId: number;
}

export class GetJackpotBetsInfoByIdRequestDto
  implements GetJackpotBetsInfoByIdRequest
{
  @IsNumber()
  public id: number;
}

export class GetJackpotWinnerRequestDto implements GetJackpotWinnerRequest {
  @IsNumber()
  public jackpotId: number;
}

export class GetWonBetsByUserIdRequestDto implements GetWonBetsByUserIdRequest {
  @IsNumber()
  public userId: number;
}
