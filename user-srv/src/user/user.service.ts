import { HttpStatus, Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';
import {
  CreateUserRequest,
  CreateUserResponse,
  DeleteUserRequest,
  DeleteUserResponse,
  GetUserByUserIdRequest,
  GetUserByUserIdResponse,
  ListAllUsersResponse,
  TestUserRequestResponse,
  UpdateUserBalanceRequest,
  UpdateUserBalanceResponse,
  UserData,
} from './proto/user.pb';
import { DeleteUserRequestDto } from './user.dto';
import { ClientGrpc } from '@nestjs/microservices';
import { AUTH_SERVICE_NAME, AuthServiceClient } from './proto/auth.pb';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class UserService implements OnModuleInit {
  @InjectRepository(User)
  private readonly repository: Repository<User>;

  @Inject(AUTH_SERVICE_NAME)
  private readonly client: ClientGrpc;
  private authSvc: AuthServiceClient;

  public onModuleInit(): void {
    this.authSvc = this.client.getService<AuthServiceClient>(AUTH_SERVICE_NAME);
  }

  public async getUserByUserId({
    userId,
  }: GetUserByUserIdRequest): Promise<GetUserByUserIdResponse> {
    const user: User = await this.repository.findOne({ where: { userId } });

    if (!user) {
      return {
        data: undefined,
        error: ['User not found'],
        status: HttpStatus.NOT_FOUND,
      };
    }

    return { data: user as UserData, error: null, status: HttpStatus.OK };
  }

  public async createUser(
    payload: CreateUserRequest,
  ): Promise<CreateUserResponse> {
    const user: User = new User();
    user.email = payload.email;
    user.userId = payload.userId;
    user.role = payload.role;

    await this.repository.save(user);

    return { id: user.id, error: null, status: HttpStatus.OK };
  }

  public async deleteUser(userId: number): Promise<DeleteUserResponse> {
    const user: User = await this.repository.findOne({ where: { userId } });

    if (!user) {
      return {
        error: ['User not found'],
        status: HttpStatus.NOT_FOUND,
      };
    }
    if (user.balance > 0) {
      return {
        error: ['Cant delete user with not 0 balance'],
        status: HttpStatus.CONFLICT,
      };
    }

    await this.repository.remove(user);
    await firstValueFrom(this.authSvc.deleteAuthById({ id: user.userId }));

    return { error: null, status: HttpStatus.OK };
  }

  public async updateUserBalance({
    userId,
    operation,
    amount,
  }: UpdateUserBalanceRequest): Promise<UpdateUserBalanceResponse> {
    const user: User = await this.repository.findOne({ where: { userId } });

    if (!user) {
      return {
        userId: undefined,
        balance: undefined,
        error: ['User not found'],
        status: HttpStatus.NOT_FOUND,
      };
    }

    if (operation === 'add') {
      user.balance = user.balance + amount;
    }
    if (operation === 'subtract') {
      user.balance = user.balance - amount;
    }
    await this.repository.save(user);

    return {
      userId: user.userId,
      balance: user.balance,
      error: null,
      status: HttpStatus.OK,
    };
  }

  public async listAllUsers(): Promise<ListAllUsersResponse> {
    const users: User[] = await this.repository.find();
    return { data: users as UserData[], error: null, status: HttpStatus.OK };
  }

  public async testUser(): Promise<TestUserRequestResponse> {
    return Promise.resolve({ status: 1 });
  }
}
