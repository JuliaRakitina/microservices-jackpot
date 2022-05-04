/* eslint-disable */
import { GrpcMethod, GrpcStreamMethod } from '@nestjs/microservices';
import Long from 'long';
import * as _m0 from 'protobufjs/minimal';
import { Observable } from 'rxjs';

export const protobufPackage = 'user';

export interface UsersData {
  email: string;
  password: string;
  role: string;
}

/** get Users Info */
export interface ListAllUsersRequest {}

export interface ListAllUsersResponse {
  status: number;
  error: string[];
  data: UsersData[];
}

/** get User Info */
export interface CreateUserRequest {
  email: string;
  password: string;
  role: string;
}

export interface CreateUserResponse {
  status: number;
  error: string[];
  id: number;
}

export const USER_PACKAGE_NAME = 'user';

export interface UserServiceClient {
  listAllUsers(request: ListAllUsersRequest): Observable<ListAllUsersResponse>;
}

export interface UserServiceController {
  listAllUsers(
    request: ListAllUsersRequest,
  ):
    | Promise<ListAllUsersResponse>
    | Observable<ListAllUsersResponse>
    | ListAllUsersResponse;
}

export function UserServiceControllerMethods() {
  return function (constructor: Function) {
    const grpcMethods: string[] = ['listAllUsers'];
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
