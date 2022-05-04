import {
  Controller,
  Inject,
  Post,
  OnModuleInit,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { Observable } from 'rxjs';
import { AuthGuard } from '../auth/auth.guard';
import { Request } from 'express';
import {
  ListAllUsersRequest,
  ListAllUsersResponse,
  USER_SERVICE_NAME,
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

  @Post()
  @UseGuards(AuthGuard)
  private async listAllUsers(
    @Req() req: Request,
  ): Promise<Observable<ListAllUsersResponse>> {
    const body: ListAllUsersRequest = req.body;

    return this.svc.listAllUsers(body);
  }
}
