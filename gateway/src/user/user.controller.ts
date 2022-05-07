import {
  Controller,
  Inject,
  Post,
  OnModuleInit,
  UseGuards,
  Req,
  Get,
  HttpStatus,
  Put,
  Delete,
} from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { Observable, of } from 'rxjs';
import { AuthGuard } from '../auth/auth.guard';
import { Request } from 'express';
import {
  DeleteUserRequest,
  DeleteUserResponse,
  GetUserByUserIdRequest,
  GetUserByUserIdResponse,
  ListAllUsersRequest,
  ListAllUsersResponse,
  UpdateUserBalanceRequest,
  UpdateUserBalanceResponse,
  USER_SERVICE_NAME,
  UserData,
  UserServiceClient,
} from './user.pb';

@Controller('user')
export class UserController implements OnModuleInit {
  private svc: UserServiceClient;

  @Inject(USER_SERVICE_NAME)
  private readonly client: ClientGrpc;

  public onModuleInit(): void {
    this.svc = this.client.getService<UserServiceClient>(USER_SERVICE_NAME);
  }

  @Post('userInfo')
  @UseGuards(AuthGuard)
  private async getUserById(
    @Req() req: Request,
  ): Promise<Observable<GetUserByUserIdResponse>> {
    const body: GetUserByUserIdRequest = req.body;
    // example of ACL implementation need to implement with pipes or interceptors
    if (req['role'] === 'admin') {
      return this.svc.getUserByUserId(body);
    } else {
      return of({
        status: HttpStatus.FORBIDDEN,
        error: ['Insufficient rights'],
        data: null,
      });
    }
  }

  @Delete('delete')
  @UseGuards(AuthGuard)
  private async deleteUser(
    @Req() req: Request,
  ): Promise<Observable<DeleteUserResponse>> {
    const body: DeleteUserRequest = req.body;
    // example of ACL implementation need to implement with pipes or interceptors
    if (req['role'] === 'admin') {
      return this.svc.deleteUser(body);
    } else {
      return of({
        status: HttpStatus.FORBIDDEN,
        error: ['Insufficient rights'],
      });
    }
  }

  @Put('updateUserBalance')
  @UseGuards(AuthGuard)
  private async updateUserBalance(
    @Req() req: Request,
  ): Promise<Observable<UpdateUserBalanceResponse>> {
    const body: UpdateUserBalanceRequest = req.body;
    // example of ACL implementation need to implement with pipes or interceptors
    if (req['role'] === 'admin') {
      return this.svc.updateUserBalance(body);
    } else {
      return of({
        status: HttpStatus.FORBIDDEN,
        error: ['Insufficient rights'],
        userId: null,
        balance: null,
      });
    }
  }

  @Get()
  @UseGuards(AuthGuard)
  private async listAllUsers(
    @Req() req: Request,
  ): Promise<Observable<ListAllUsersResponse>> {
    const body: ListAllUsersRequest = req.body;
    // example of ACL implementation need to implement with pipes or interceptors
    if (req['role'] === 'admin') {
      return this.svc.listAllUsers(body);
    } else {
      return of({
        status: HttpStatus.FORBIDDEN,
        error: ['Insufficient rights'],
        data: null,
      });
    }
  }
}
