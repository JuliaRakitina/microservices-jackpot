import { Controller, Inject } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { UserService } from './user.service';
import {
  CreateUserRequest,
  CreateUserResponse,
  DeleteUserRequest,
  DeleteUserResponse,
  UpdateUserBalanceRequest,
  UpdateUserBalanceResponse,
  USER_SERVICE_NAME,
} from './user.pb';
import {
  CreateUserRequestDto,
  DeleteUserRequestDto,
  UpdateUserBalanceRequestDto,
} from './user.dto';

@Controller()
export class UserController {
  @Inject(UserService)
  private readonly service: UserService;

  @GrpcMethod(USER_SERVICE_NAME, 'CreateUser')
  private createUser(
    payload: CreateUserRequestDto,
  ): Promise<CreateUserResponse> {
    return this.service.createUser(payload);
  }

  @GrpcMethod(USER_SERVICE_NAME, 'UpdateUserBalanceRequest')
  private UpdateUserBalance(
    payload: UpdateUserBalanceRequestDto,
  ): Promise<UpdateUserBalanceResponse> {
    return this.service.updateUserBalance(payload);
  }

  @GrpcMethod(USER_SERVICE_NAME, 'DeleteUser')
  private deleteUser(
    payload: DeleteUserRequestDto,
  ): Promise<DeleteUserResponse> {
    return this.service.deleteUser(payload);
  }
}
