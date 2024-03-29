/* eslint-disable */
import { GrpcMethod, GrpcStreamMethod } from '@nestjs/microservices';
import Long from 'long';
import * as _m0 from 'protobufjs/minimal';
import { Observable } from 'rxjs';

export const protobufPackage = 'jackpot';

export interface JackpotData {
  id: number;
  amount: number;
  status: string;
}

export interface CreateJackpotRequest {
  seed: number;
}

export interface CreateJackpotResponse {
  status: number;
  error: string[];
  id: number;
}

export interface ListAllJackpotsRequest {}

export interface ListAllJackpotsResponse {
  status: number;
  error: string[];
  data: JackpotData[];
}

export interface AddJackpotAmountRequest {
  id: number;
  amount: number;
}

export interface AddJackpotAmountResponse {
  status: number;
  error: string[];
  id: number;
  amount: number;
  isWon: boolean;
}

export interface RunJackpotRequest {
  id: number;
}

export interface RunJackpotResponse {
  status: number;
  error: string[];
}

export interface StopActiveJackpotRequest {
  id: number;
}

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
  userId: number;
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

  listAllJackpots(
    request: ListAllJackpotsRequest,
  ): Observable<ListAllJackpotsResponse>;

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

  listAllJackpots(
    request: ListAllJackpotsRequest,
  ):
    | Promise<ListAllJackpotsResponse>
    | Observable<ListAllJackpotsResponse>
    | ListAllJackpotsResponse;

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
      'listAllJackpots',
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

if (_m0.util.Long !== Long) {
  _m0.util.Long = Long as any;
  _m0.configure();
}
