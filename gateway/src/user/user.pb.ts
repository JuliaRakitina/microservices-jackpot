/* eslint-disable */
import { GrpcMethod, GrpcStreamMethod } from '@nestjs/microservices';
import * as Long from 'long';
import * as _m0 from 'protobufjs/minimal';
import { Observable } from 'rxjs';

export const protobufPackage = 'user';

export interface UsersData {
  email: string;
  password: string;
  role: string;
}

/** get User Info */
export interface ListAllUsersRequest {}

export interface ListAllUsersResponse {
  status: number;
  error: string[];
  data: UsersData[];
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

// If you get a compile-error about 'Constructor<Long> and ... have no overlap',
// add '--ts_proto_opt=esModuleInterop=true' as a flag when calling 'protoc'.
if (_m0.util.Long !== Long) {
  _m0.util.Long = Long as any;
  _m0.configure();
}
