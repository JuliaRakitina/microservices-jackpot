import { Controller, Inject } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import {
  LoginRequestDto,
  RegisterRequestDto,
  ValidateRequestDto,
} from './auth.dto';
import {
  AUTH_SERVICE_NAME,
  RegisterResponse,
  LoginResponse,
  ValidateResponse,
  DeleteAuthByIdRequest,
  DeleteAuthByIdResponse,
} from './proto/auth.pb';
import { AuthService } from './service/auth.service';

@Controller()
export class AuthController {
  @Inject(AuthService)
  private readonly service: AuthService;

  @GrpcMethod(AUTH_SERVICE_NAME, 'Register')
  private register(payload: RegisterRequestDto): Promise<RegisterResponse> {
    return this.service.register(payload);
  }

  @GrpcMethod(AUTH_SERVICE_NAME, 'Login')
  private login(payload: LoginRequestDto): Promise<LoginResponse> {
    return this.service.login(payload);
  }

  @GrpcMethod(AUTH_SERVICE_NAME, 'Validate')
  private validate(payload: ValidateRequestDto): Promise<ValidateResponse> {
    return this.service.validate(payload);
  }

  @GrpcMethod(AUTH_SERVICE_NAME, 'DeleteAuthById')
  private deleteAuthById(
    payload: DeleteAuthByIdRequest,
  ): Promise<DeleteAuthByIdResponse> {
    return this.service.deleteAuthById(payload);
  }
}
