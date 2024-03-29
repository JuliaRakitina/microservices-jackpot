import { HttpStatus, Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from './jwt.service';
import {
  RegisterRequestDto,
  LoginRequestDto,
  ValidateRequestDto,
} from '../auth.dto';
import { Auth } from '../auth.entity';
import {
  DeleteAuthByIdRequest,
  DeleteAuthByIdResponse,
  LoginResponse,
  RegisterResponse,
  ValidateResponse,
} from '../proto/auth.pb';
import { USER_SERVICE_NAME, UserServiceClient } from '../proto/user.pb';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class AuthService implements OnModuleInit {
  @InjectRepository(Auth)
  private readonly repository: Repository<Auth>;

  @Inject(JwtService)
  private readonly jwtService: JwtService;

  private userSvc: UserServiceClient;

  @Inject(USER_SERVICE_NAME)
  private readonly client: ClientGrpc;

  public onModuleInit(): void {
    this.userSvc = this.client.getService<UserServiceClient>(USER_SERVICE_NAME);
  }

  public async register({
    email,
    password,
    role,
  }: RegisterRequestDto): Promise<RegisterResponse> {
    let auth: Auth = await this.repository.findOne({ where: { email } });

    if (auth) {
      return { status: HttpStatus.CONFLICT, error: ['E-mail already exists'] };
    }

    auth = new Auth();

    auth.email = email;
    auth.password = this.jwtService.encodePassword(password);
    auth.role = role;

    const { id } = await this.repository.save(auth);
    const data = {
      email,
      userId: id,
      role,
    };

    this.userSvc.createUser(data).subscribe((user) => {
      console.info(`User saved in User ms with id ${user.id}`);
    });

    return { status: HttpStatus.CREATED, error: null };
  }

  public async login({
    email,
    password,
  }: LoginRequestDto): Promise<LoginResponse> {
    const auth: Auth = await this.repository.findOne({ where: { email } });

    if (!auth) {
      return {
        status: HttpStatus.NOT_FOUND,
        error: ['E-mail not found'],
        token: null,
      };
    }

    const isPasswordValid: boolean = this.jwtService.isPasswordValid(
      password,
      auth.password,
    );

    if (!isPasswordValid) {
      return {
        status: HttpStatus.NOT_FOUND,
        error: ['Password wrong'],
        token: null,
      };
    }

    const user = await firstValueFrom(
      this.userSvc.getUserByUserId({ userId: auth.id }),
    );
    auth.role = user.data?.role;
    const token: string = this.jwtService.generateToken(auth);
    return { token, status: HttpStatus.OK, error: null };
  }

  public async validate({
    token,
  }: ValidateRequestDto): Promise<ValidateResponse> {
    const decoded: Auth = await this.jwtService.verify(token);

    if (!decoded) {
      return {
        status: HttpStatus.FORBIDDEN,
        error: ['Token is invalid'],
        userId: null,
        role: null,
      };
    }

    const auth: Auth = await this.jwtService.validateUser(decoded);

    if (!auth) {
      return {
        status: HttpStatus.CONFLICT,
        error: ['User not found'],
        userId: null,
        role: null,
      };
    }

    return {
      status: HttpStatus.OK,
      error: null,
      userId: decoded.id,
      role: decoded.role,
    };
  }

  public async deleteAuthById({
    id,
  }: DeleteAuthByIdRequest): Promise<DeleteAuthByIdResponse> {
    const auth: Auth = await this.repository.findOne({ where: { id } });

    if (!auth) {
      return {
        error: ['Auth info not found'],
        status: HttpStatus.NOT_FOUND,
      };
    }
    await this.repository.remove(auth);
    return { status: HttpStatus.OK, error: null };
  }
}
