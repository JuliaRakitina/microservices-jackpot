/* eslint-disable */
import { GrpcMethod, GrpcStreamMethod } from '@nestjs/microservices';
import Long from 'long';
import * as _m0 from 'protobufjs/minimal';
import { Observable } from 'rxjs';

export const protobufPackage = 'bet';

export interface BetData {
  id: number;
  userId: number;
  jackpotId: number;
  bet: number;
  /** won , slip */
  status: string;
}

export interface MakeBetRequest {
  id: number;
  userId: number;
  jackpotId: number;
  bet: number;
}

export interface MakeBetResponse {
  status: number;
  error: string[];
  data: BetData | undefined;
}

export interface GetBetsByUserIdRequest {
  userId: number;
}

export interface GetBetsByUserIdResponse {
  status: number;
  error: string[];
  data: BetData[];
}

export interface GetJackpotBetsInfoIdRequest {
  userId: number;
}

export interface GetJackpotBetsInfoIdResponse {
  status: number;
  error: string[];
  data: BetData[];
}

export interface GetJackpotWinnerRequest {
  jackpotId: number;
}

export interface GetJackpotWinnerResponse {
  status: number;
  error: string[];
  jackpotStatus: string;
  userId: string;
  bet: string;
}

export interface GetWonBetsByUserIdRequest {
  jackpotId: number;
}

export interface GetWonBetsByUserIdResponse {
  status: number;
  error: string[];
  data: BetData[];
}

export const BET_PACKAGE_NAME = 'bet';

export interface UserServiceClient {
  makeBet(request: MakeBetRequest): Observable<MakeBetResponse>;

  getBetsByUserId(
    request: GetBetsByUserIdRequest,
  ): Observable<GetBetsByUserIdResponse>;

  getJackpotBetsInfoId(
    request: GetJackpotBetsInfoIdRequest,
  ): Observable<GetJackpotBetsInfoIdResponse>;

  getJackpotWinner(
    request: GetJackpotWinnerRequest,
  ): Observable<GetJackpotWinnerResponse>;

  getWonBetsByUserId(
    request: GetWonBetsByUserIdRequest,
  ): Observable<GetWonBetsByUserIdResponse>;
}

export interface UserServiceController {
  makeBet(
    request: MakeBetRequest,
  ): Promise<MakeBetResponse> | Observable<MakeBetResponse> | MakeBetResponse;

  getBetsByUserId(
    request: GetBetsByUserIdRequest,
  ):
    | Promise<GetBetsByUserIdResponse>
    | Observable<GetBetsByUserIdResponse>
    | GetBetsByUserIdResponse;

  getJackpotBetsInfoId(
    request: GetJackpotBetsInfoIdRequest,
  ):
    | Promise<GetJackpotBetsInfoIdResponse>
    | Observable<GetJackpotBetsInfoIdResponse>
    | GetJackpotBetsInfoIdResponse;

  getJackpotWinner(
    request: GetJackpotWinnerRequest,
  ):
    | Promise<GetJackpotWinnerResponse>
    | Observable<GetJackpotWinnerResponse>
    | GetJackpotWinnerResponse;

  getWonBetsByUserId(
    request: GetWonBetsByUserIdRequest,
  ):
    | Promise<GetWonBetsByUserIdResponse>
    | Observable<GetWonBetsByUserIdResponse>
    | GetWonBetsByUserIdResponse;
}

export function UserServiceControllerMethods() {
  return function (constructor: Function) {
    const grpcMethods: string[] = [
      'makeBet',
      'getBetsByUserId',
      'getJackpotBetsInfoId',
      'getJackpotWinner',
      'getWonBetsByUserId',
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
