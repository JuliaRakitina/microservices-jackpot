import { IsNotEmpty, IsNumber, IsString } from 'class-validator';
import {
  CreateUserRequest,
  DeleteUserRequest,
  GetUserByUserIdRequest,
  UpdateUserBalanceRequest,
} from './user.pb';

export class GetUserByUserIdRequestDto implements GetUserByUserIdRequest {
  @IsNumber({ allowInfinity: false, allowNaN: false })
  public readonly userId: number;
}

export class CreateUserRequestDto implements CreateUserRequest {
  @IsString()
  @IsNotEmpty()
  public readonly email: string;

  @IsNumber()
  @IsNotEmpty()
  public readonly userId: number;

  @IsString()
  @IsNotEmpty()
  public readonly role: 'admin' | 'player';
}

export class UpdateUserBalanceRequestDto implements UpdateUserBalanceRequest {
  @IsNumber()
  @IsNotEmpty()
  public readonly userId: number;

  @IsString()
  @IsNotEmpty()
  public readonly operation: 'add' | 'subtract';

  @IsNumber()
  @IsNotEmpty()
  public readonly amount: number;
}

export class DeleteUserRequestDto implements DeleteUserRequest {
  @IsNumber()
  @IsNotEmpty()
  public readonly userId: number;
}
