/* eslint-disable */
import { GrpcMethod, GrpcStreamMethod } from '@nestjs/microservices';
import Long from 'long';
import * as _m0 from 'protobufjs/minimal';
import { Observable } from 'rxjs';

export const protobufPackage = 'user';

export interface UserData {
  id: number;
  email: string;
  userId: number;
  role: string;
  balance: number;
}

/** get Users Info */
export interface ListAllUsersRequest {}

export interface ListAllUsersResponse {
  status: number;
  error: string[];
  data: UserData[];
}

/** create User */
export interface CreateUserRequest {
  email: string;
  userId: number;
  role: string;
}

export interface CreateUserResponse {
  status: number;
  error: string[];
  id: number;
}

/** create User */
export interface UpdateUserBalanceRequest {
  userId: number;
  operation: string;
  amount: number;
}

export interface UpdateUserBalanceResponse {
  status: number;
  error: string[];
  userId: number;
  balance: number;
}

/** get User by userId */
export interface GetUserByUserIdRequest {
  userId: number;
}

export interface GetUserByUserIdResponse {
  status: number;
  error: string[];
  data: UserData | undefined;
}

/** get User by userId */
export interface DeleteUserRequest {
  userId: number;
}

export interface DeleteUserResponse {
  status: number;
  error: string[];
}

/** get Users Info */
export interface TestUserRequest {}

export interface TestUserRequestResponse {
  status: number;
}

export const USER_PACKAGE_NAME = 'user';

export interface UserServiceClient {
  createUser(request: CreateUserRequest): Observable<CreateUserResponse>;

  testUser(request: TestUserRequest): Observable<TestUserRequestResponse>;

  updateUserBalance(
    request: UpdateUserBalanceRequest,
  ): Observable<UpdateUserBalanceResponse>;

  getUserByUserId(
    request: GetUserByUserIdRequest,
  ): Observable<GetUserByUserIdResponse>;

  deleteUser(request: DeleteUserRequest): Observable<DeleteUserResponse>;

  listAllUsers(request: ListAllUsersRequest): Observable<ListAllUsersResponse>;
}

export interface UserServiceController {
  createUser(
    request: CreateUserRequest,
  ):
    | Promise<CreateUserResponse>
    | Observable<CreateUserResponse>
    | CreateUserResponse;

  testUser(
    request: TestUserRequest,
  ):
    | Promise<TestUserRequestResponse>
    | Observable<TestUserRequestResponse>
    | TestUserRequestResponse;

  updateUserBalance(
    request: UpdateUserBalanceRequest,
  ):
    | Promise<UpdateUserBalanceResponse>
    | Observable<UpdateUserBalanceResponse>
    | UpdateUserBalanceResponse;

  getUserByUserId(
    request: GetUserByUserIdRequest,
  ):
    | Promise<GetUserByUserIdResponse>
    | Observable<GetUserByUserIdResponse>
    | GetUserByUserIdResponse;

  deleteUser(
    request: DeleteUserRequest,
  ):
    | Promise<DeleteUserResponse>
    | Observable<DeleteUserResponse>
    | DeleteUserResponse;

  listAllUsers(
    request: ListAllUsersRequest,
  ):
    | Promise<ListAllUsersResponse>
    | Observable<ListAllUsersResponse>
    | ListAllUsersResponse;
}

export function UserServiceControllerMethods() {
  return function (constructor: Function) {
    const grpcMethods: string[] = [
      'createUser',
      'testUser',
      'updateUserBalance',
      'getUserByUserId',
      'deleteUser',
      'listAllUsers',
    ];
    for (const method of grpcMethods) {
      const descriptor: any = Reflect.getOwnPropertyDescriptor(
        constructor.prototype,
        method,
      );
      GrpcMethod('UserService', method)(
        constructor.prototype[method],
        method,
        descriptor,
      );
    }
    const grpcStreamMethods: string[] = [];
    for (const method of grpcStreamMethods) {
      const descriptor: any = Reflect.getOwnPropertyDescriptor(
        constructor.prototype,
        method,
      );
      GrpcStreamMethod('UserService', method)(
        constructor.prototype[method],
        method,
        descriptor,
      );
    }
  };
}

export const USER_SERVICE_NAME = 'UserService';

if (_m0.util.Long !== Long) {
  _m0.util.Long = Long as any;
  _m0.configure();
}
