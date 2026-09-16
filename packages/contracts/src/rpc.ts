import { randomUUID, timingSafeEqual } from 'node:crypto';
import * as grpc from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { resolve } from 'node:path';
import type * as api from './generated/jackpot/v1/api.js';
import { DomainError, type ErrorCode, errorCodes } from './errors.js';
import { withSpan, traceHeader } from '../../observability/src/index.js';
import { Registry, Counter } from '@prometheus-io/client';
import { z } from 'zod';

export const rpcRegistry = new Registry();
const failures = new Counter({
  name: 'grpc_errors_total',
  help: 'Failed gRPC calls',
  labelNames: ['service', 'method', 'code'],
  registers: [rpcRegistry],
});

type Call<Request, Response> = (
  request: Request,
  correlationId?: string,
) => Promise<Response>;
export interface RpcClients {
  auth: {
    register: Call<api.RegisterRequest, api.RegisterResponse>;
    login: Call<api.LoginRequest, api.LoginResponse>;
    verify: Call<api.VerifyRequest, api.VerifyResponse>;
  };
  users: {
    getUser: Call<api.GetUserRequest, api.GetUserResponse>;
    getLedger: Call<api.GetLedgerRequest, api.GetLedgerResponse>;
    credit: Call<api.CreditRequest, api.CreditResponse>;
  };
  bets: {
    submit: Call<api.SubmitRequest, api.SubmitResponse>;
    getBet: Call<api.GetBetRequest, api.GetBetResponse>;
  };
  jackpot: { getPool: Call<api.GetPoolRequest, api.GetPoolResponse> };
}
const definition = loadSync(
  resolve('packages/contracts/proto/jackpot/v1/api.proto'),
  { keepCase: false, longs: String, defaults: true },
);
const rpcStatus: Record<ErrorCode, number> = Object.fromEntries(
  errorCodes.map((code) => [code, grpc.status[code]]),
) as Record<ErrorCode, number>;
const serviceNames = {
  auth: 'AuthService',
  users: 'UsersService',
  bets: 'BetsService',
  jackpot: 'JackpotService',
} as const;
type ServiceName = keyof typeof serviceNames;
export function createClients(
  addresses: Record<ServiceName, string>,
  token: string,
): { clients: RpcClients; close: () => void; ready: () => Promise<boolean> } {
  const raw: grpc.Client[] = [];
  const services: Record<string, Record<string, Call<unknown, unknown>>> = {};
  for (const name of Object.keys(serviceNames) as ServiceName[]) {
    const service = definition[
      `jackpot.v1.${serviceNames[name]}`
    ] as grpc.ServiceDefinition;
    const Constructor = grpc.makeGenericClientConstructor(
      service,
      serviceNames[name],
    );
    const client = new Constructor(
      addresses[name],
      grpc.credentials.createInsecure(),
      {
        'grpc.max_receive_message_length': 65536,
        'grpc.max_send_message_length': 65536,
      },
    );
    raw.push(client);
    services[name] = {};
    for (const method of Object.keys(service)) {
      const lower = method[0]!.toLowerCase() + method.slice(1);
      services[name][lower] = (request, correlationId = randomUUID()) =>
        withSpan(
          `grpc.client.${name}.${lower}`,
          correlationId,
          () =>
            new Promise((resolveResult, reject) => {
              const metadata = new grpc.Metadata();
              metadata.set('x-service-token', token);
              metadata.set('x-correlation-id', correlationId);
              const traceparent = traceHeader();
              if (traceparent) metadata.set('traceparent', traceparent);
              const descriptor = service[method]!;
              client.makeUnaryRequest(
                descriptor.path,
                descriptor.requestSerialize,
                descriptor.responseDeserialize,
                request,
                metadata,
                { deadline: Date.now() + 3000 },
                (error, response) => {
                  if (error) {
                    const code =
                      errorCodes.find((c) => rpcStatus[c] === error.code) ??
                      (error.code === grpc.status.DEADLINE_EXCEEDED
                        ? 'UNAVAILABLE'
                        : 'INTERNAL');
                    failures.inc({ service: name, method: lower, code });
                    reject(
                      new DomainError(
                        code,
                        code === 'INTERNAL' || code === 'UNAVAILABLE'
                          ? 'Service temporarily unavailable'
                          : error.details,
                      ),
                    );
                  } else resolveResult(response);
                },
              );
            }),
        );
    }
  }
  return {
    clients: services as unknown as RpcClients,
    close: () => raw.forEach((c) => c.close()),
    ready: async () =>
      (
        await Promise.all(
          raw.map(
            (c) =>
              new Promise<boolean>((r) =>
                c.waitForReady(Date.now() + 1000, (e) => r(!e)),
              ),
          ),
        )
      ).every(Boolean),
  };
}
export async function serveRpc(
  name: ServiceName,
  implementation: object,
  token: string,
  port: number,
): Promise<grpc.Server & { port: number }> {
  const service = definition[
    `jackpot.v1.${serviceNames[name]}`
  ] as grpc.ServiceDefinition;
  const handlers: grpc.UntypedServiceImplementation = {};
  for (const method of Object.keys(service)) {
    const lower = method[0]!.toLowerCase() + method.slice(1);
    handlers[method] = async (
      call: grpc.ServerUnaryCall<unknown, unknown>,
      callback: grpc.sendUnaryData<unknown>,
    ) => {
      try {
        const supplied = call.metadata.get('x-service-token')[0];
        if (
          typeof supplied !== 'string' ||
          Buffer.byteLength(supplied) !== Buffer.byteLength(token) ||
          !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))
        )
          throw new DomainError(
            'UNAUTHENTICATED',
            'Internal authentication required',
          );
        const value = call.metadata.get('x-correlation-id')[0];
        const correlationId =
          typeof value === 'string' && z.uuid().safeParse(value).success
            ? value
            : randomUUID();
        const traceparent = call.metadata.get('traceparent')[0];
        const invoke = (
          implementation as Record<string, Call<unknown, unknown>>
        )[lower];
        if (!invoke) throw new DomainError('INTERNAL', 'Unknown method');
        const response = await withSpan(
          `grpc.server.${name}.${lower}`,
          correlationId,
          () => invoke.call(implementation, call.request, correlationId),
          typeof traceparent === 'string' ? traceparent : undefined,
        );
        callback(null, response);
      } catch (error) {
        const known = error instanceof DomainError;
        failures.inc({
          service: name,
          method: lower,
          code: known ? error.code : 'INTERNAL',
        });
        callback(
          {
            code: known ? rpcStatus[error.code] : grpc.status.INTERNAL,
            message: known ? error.message : 'Internal service error',
          },
          null,
        );
      }
    };
  }
  const server = new grpc.Server({
    'grpc.max_receive_message_length': 65536,
    'grpc.max_send_message_length': 65536,
  });
  server.addService(service, handlers);
  const boundPort = await new Promise<number>((resolveReady, reject) =>
    server.bindAsync(
      `0.0.0.0:${port}`,
      grpc.ServerCredentials.createInsecure(),
      (e, p) => (e ? reject(e) : resolveReady(p)),
    ),
  );
  return Object.assign(server, { port: boundPort });
}
