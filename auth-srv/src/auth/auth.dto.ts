import { IsEmail, IsString, MinLength } from 'class-validator';
import {
  LoginRequest,
  RegisterRequest,
  ValidateRequest,
} from './proto/auth.pb';

export class LoginRequestDto implements LoginRequest {
  @IsEmail()
  public readonly email: string;

  @IsString()
  public readonly password: string;
}

export class RegisterRequestDto implements RegisterRequest {
  @IsEmail()
  public readonly email: string;

  @IsString()
  @MinLength(8)
  public readonly password: string;

  @IsString()
  public readonly role: 'admin' | 'player';
}

export class ValidateRequestDto implements ValidateRequest {
  @IsString()
  public readonly token: string;
}
