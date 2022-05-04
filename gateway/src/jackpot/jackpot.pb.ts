/* eslint-disable */
import { GrpcMethod, GrpcStreamMethod } from '@nestjs/microservices';
import * as Long from 'long';
import * as _m0 from 'protobufjs/minimal';
import { Observable } from 'rxjs';

export const protobufPackage = 'jackpot';

export interface CreateJackpotRequest {}

export interface CreateJackpotResponse {
  status: number;
  error: string[];
  id: number;
}

export interface AddJackpotAmountRequest {
  id: number;
  amount: number;
}

export interface AddJackpotAmountResponse {
  status: number;
  error: string[];
}

export interface RunJackpotRequest {
  id: number;
}

export interface RunJackpotResponse {
  status: number;
  error: string[];
}

export interface StopActiveJackpotRequest {}

export interface StopActiveJackpotResponse {
  status: number;
  error: string[];
}

export interface DeleteJackpotRequest {
  id: number;
}

export interface DeleteJackpotResponse {
  status: number;
  error: string[];
}

export interface WithdrawFromJackpotRequest {
  id: number;
  amount: number;
}

export interface WithdrawFromJackpotResponse {
  status: number;
  error: string[];
}

export const JACKPOT_PACKAGE_NAME = 'jackpot';

export interface JackpotServiceClient {
  createJackpot(
    request: CreateJackpotRequest,
  ): Observable<CreateJackpotResponse>;

  addJackpotAmount(
    request: AddJackpotAmountRequest,
  ): Observable<AddJackpotAmountResponse>;

  runJackpot(request: RunJackpotRequest): Observable<RunJackpotResponse>;

  stopActiveJackpot(
    request: StopActiveJackpotRequest,
  ): Observable<StopActiveJackpotResponse>;

  deleteJackpot(
    request: DeleteJackpotRequest,
  ): Observable<DeleteJackpotResponse>;

  withdrawFromJackpot(
    request: WithdrawFromJackpotRequest,
  ): Observable<WithdrawFromJackpotResponse>;
}

export interface JackpotServiceController {
  createJackpot(
    request: CreateJackpotRequest,
  ):
    | Promise<CreateJackpotResponse>
    | Observable<CreateJackpotResponse>
    | CreateJackpotResponse;

  addJackpotAmount(
    request: AddJackpotAmountRequest,
  ):
    | Promise<AddJackpotAmountResponse>
    | Observable<AddJackpotAmountResponse>
    | AddJackpotAmountResponse;

  runJackpot(
    request: RunJackpotRequest,
  ):
    | Promise<RunJackpotResponse>
    | Observable<RunJackpotResponse>
    | RunJackpotResponse;

  stopActiveJackpot(
    request: StopActiveJackpotRequest,
  ):
    | Promise<StopActiveJackpotResponse>
    | Observable<StopActiveJackpotResponse>
    | StopActiveJackpotResponse;

  deleteJackpot(
    request: DeleteJackpotRequest,
  ):
    | Promise<DeleteJackpotResponse>
    | Observable<DeleteJackpotResponse>
    | DeleteJackpotResponse;

  withdrawFromJackpot(
    request: WithdrawFromJackpotRequest,
  ):
    | Promise<WithdrawFromJackpotResponse>
    | Observable<WithdrawFromJackpotResponse>
    | WithdrawFromJackpotResponse;
}

export function JackpotServiceControllerMethods() {
  return function (constructor: Function) {
    const grpcMethods: string[] = [
      'createJackpot',
      'addJackpotAmount',
      'runJackpot',
      'stopActiveJackpot',
      'deleteJackpot',
      'withdrawFromJackpot',
    ];
    for (const method of grpcMethods) {
      const descriptor: any = Reflect.getOwnPropertyDescriptor(
        constructor.prototype,
        method,
      );
      GrpcMethod('JackpotService', method)(
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
      GrpcStreamMethod('JackpotService', method)(
        constructor.prototype[method],
        method,
        descriptor,
      );
    }
  };
}

export const JACKPOT_SERVICE_NAME = 'JackpotService';

// If you get a compile-error about 'Constructor<Long> and ... have no overlap',
// add '--ts_proto_opt=esModuleInterop=true' as a flag when calling 'protoc'.
if (_m0.util.Long !== Long) {
  _m0.util.Long = Long as any;
  _m0.configure();
}
