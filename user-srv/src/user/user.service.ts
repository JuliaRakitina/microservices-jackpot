import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';
import {
  CreateUserRequest,
  CreateUserResponse,
  DeleteUserRequest,
  GetUserByUserIdRequest,
  GetUserByUserIdResponse,
  UpdateUserBalanceRequest,
  UpdateUserBalanceResponse,
  UserData,
} from './user.pb';
import { DeleteUserRequestDto } from './user.dto';

@Injectable()
export class UserService {
  @InjectRepository(User)
  private readonly repository: Repository<User>;

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

  public async deleteUser({
    userId,
  }: DeleteUserRequestDto): Promise<DeleteUserRequest> {
    const user: User = await this.repository.findOne({ where: { userId } });

    if (!user) {
      return {
        userId: undefined,
        error: ['User not found'],
        status: HttpStatus.NOT_FOUND,
      };
    }
    if (user.balance > 0) {
      return {
        userId: undefined,
        error: ['Cant delete user with not 0 balance'],
        status: HttpStatus.CONFLICT,
      };
    }

    await this.repository.remove(user);

    return { userId: user.id, error: null, status: HttpStatus.OK };
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
}
