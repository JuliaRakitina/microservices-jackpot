import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import {
  ArgumentsHost,
  Body,
  Catch,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Module,
  Param,
  Post,
  Req,
  Res,
  type ExceptionFilter,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
  DocumentBuilder,
  SwaggerModule,
} from '@nestjs/swagger';
import { json, type Request, type Response, type NextFunction } from 'express';
import { Counter, Histogram, Registry } from '@prometheus-io/client';
import { z } from 'zod';
import {
  DomainError,
  parse,
  type ErrorCode,
} from '../../../packages/contracts/src/errors.js';
import { MAX_POINTS } from '../../../packages/contracts/src/points.js';
import {
  rpcRegistry,
  type RpcClients,
} from '../../../packages/contracts/src/rpc.js';
import { logger, withSpan } from '../../../packages/observability/src/index.js';

type CorrelatedRequest = Request & { correlationId: string };

class AuthRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('Too many authentication attempts; retry later');
  }
}

const registrationSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(12).max(128),
  })
  .strict();
const loginSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(1).max(128),
  })
  .strict();
const amountSchema = z
  .object({
    amount: z
      .string()
      .regex(/^[1-9][0-9]{0,18}$/)
      .refine((value) => value.length < 19 || value <= MAX_POINTS.toString()),
  })
  .strict();
const idSchema = z.string().uuid();
const keySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
const HTTP_STATUS: Record<ErrorCode, number> = {
  INVALID_ARGUMENT: 400,
  UNAUTHENTICATED: 401,
  PERMISSION_DENIED: 403,
  NOT_FOUND: 404,
  ALREADY_EXISTS: 409,
  FAILED_PRECONDITION: 409,
  UNAVAILABLE: 503,
  INTERNAL: 500,
};
const GRPC_CODE: Record<number, ErrorCode> = {
  3: 'INVALID_ARGUMENT',
  5: 'NOT_FOUND',
  6: 'ALREADY_EXISTS',
  7: 'PERMISSION_DENIED',
  9: 'FAILED_PRECONDITION',
  16: 'UNAUTHENTICATED',
  4: 'UNAVAILABLE',
  14: 'UNAVAILABLE',
};

/** HTTP owns status codes; domain errors and protobuf messages do not. */
export function mapHttpError(error: unknown): {
  status: number;
  code: ErrorCode | 'RATE_LIMITED';
  message: string;
} {
  if (error instanceof AuthRateLimitError) {
    return { status: 429, code: 'RATE_LIMITED', message: error.message };
  }
  if (error instanceof DomainError) {
    return {
      status: HTTP_STATUS[error.code],
      code: error.code,
      message:
        error.code === 'INTERNAL' ? 'Internal server error' : error.message,
    };
  }
  if (error instanceof HttpException) {
    const status = error.getStatus();
    const code =
      status === 404
        ? 'NOT_FOUND'
        : status === 413 || status === 400
          ? 'INVALID_ARGUMENT'
          : 'INTERNAL';
    return {
      status: code === 'INTERNAL' ? 500 : status,
      code,
      message:
        code === 'NOT_FOUND'
          ? 'Route not found'
          : code === 'INVALID_ARGUMENT'
            ? 'Invalid request'
            : 'Internal server error',
    };
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'number'
  ) {
    const code = GRPC_CODE[error.code] ?? 'INTERNAL';
    // Low-level gRPC messages may contain addresses or debugging details.
    return {
      status: HTTP_STATUS[code],
      code,
      message:
        code === 'UNAVAILABLE'
          ? 'Service temporarily unavailable'
          : code === 'INTERNAL'
            ? 'Internal server error'
            : 'Request rejected',
    };
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error.status === 400 || error.status === 413)
  ) {
    return {
      status: error.status,
      code: 'INVALID_ARGUMENT',
      message:
        error.status === 413
          ? 'Request body is too large'
          : 'Invalid JSON request',
    };
  }
  return { status: 500, code: 'INTERNAL', message: 'Internal server error' };
}

const credentialsBody = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['email', 'password'],
  properties: {
    email: { type: 'string', format: 'email' },
    password: {
      type: 'string',
      minLength: 12,
      maxLength: 128,
      writeOnly: true,
    },
  },
};
const pointsBody = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['amount'],
  properties: {
    amount: { type: 'string', pattern: '^[1-9][0-9]{0,18}$', example: '100' },
  },
};
const idempotencyHeader = {
  name: 'Idempotency-Key',
  required: true,
  description:
    '8–128 characters: letters, digits, dot, underscore, colon, hyphen.',
};

export async function createGateway(
  clients: RpcClients,
  readiness: () => Promise<boolean>,
) {
  const log = logger('gateway');
  const registry = new Registry();
  // Local demonstration protection: one process, 30 attempts/minute/IP. A
  // deployment with multiple replicas needs a shared limiter at its trusted edge.
  const authAttempts = new Map<string, { count: number; expiresAt: number }>();
  const authWindowMs = 60_000;
  const authAttemptLimit = 30;
  const maxTrackedAddresses = 10_000;
  let nextPruneAt = 0;

  function enforceAuthRateLimit(request: CorrelatedRequest) {
    const now = Date.now();
    if (now >= nextPruneAt) {
      for (const [address, attempts] of authAttempts) {
        if (attempts.expiresAt <= now) authAttempts.delete(address);
      }
      nextPruneAt = now + authWindowMs;
    }
    // The socket peer is authoritative. Untrusted Forwarded/X-Forwarded-For
    // headers must never allow callers to manufacture extra rate-limit buckets.
    const address = request.socket.remoteAddress ?? 'unknown';
    let attempts = authAttempts.get(address);
    if (!attempts || attempts.expiresAt <= now) {
      if (!attempts && authAttempts.size >= maxTrackedAddresses) {
        throw new AuthRateLimitError(
          Math.max(1, Math.ceil((nextPruneAt - now) / 1000)),
        );
      }
      attempts = { count: 0, expiresAt: now + authWindowMs };
      authAttempts.set(address, attempts);
    }
    if (attempts.count >= authAttemptLimit) {
      throw new AuthRateLimitError(
        Math.max(1, Math.ceil((attempts.expiresAt - now) / 1000)),
      );
    }
    attempts.count++;
  }
  const requests = new Counter({
    name: 'jackpot_http_requests_total',
    help: 'HTTP requests by route and status.',
    labelNames: ['method', 'route', 'status'],
    registers: [registry],
  });
  const durations = new Histogram({
    name: 'jackpot_http_request_duration_seconds',
    help: 'HTTP response duration.',
    labelNames: ['method', 'route'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
    registers: [registry],
  });

  async function principal(request: CorrelatedRequest) {
    const authorization = request.header('authorization');
    const token =
      authorization && /^Bearer ([^\s]+)$/i.exec(authorization)?.[1];
    if (!token || token.length > 8192)
      throw new DomainError(
        'UNAUTHENTICATED',
        'A bearer access token is required',
      );
    return clients.auth.verify({ token }, request.correlationId);
  }

  @Catch()
  class ApiExceptionFilter implements ExceptionFilter {
    catch(error: unknown, host: ArgumentsHost) {
      const request = host.switchToHttp().getRequest<CorrelatedRequest>();
      const response = host.switchToHttp().getResponse<Response>();
      const mapped = mapHttpError(error);
      const correlationId = request.correlationId ?? randomUUID();
      if (mapped.status >= 500)
        log.error({ code: mapped.code, correlationId }, 'HTTP request failed');
      response.setHeader('x-correlation-id', correlationId);
      if (error instanceof AuthRateLimitError) {
        response.setHeader('retry-after', String(error.retryAfterSeconds));
      }
      response.status(mapped.status).json({
        error: { code: mapped.code, message: mapped.message },
        correlationId,
      });
    }
  }

  @Controller()
  @ApiTags('Simulator')
  @ApiResponse({
    status: 400,
    description:
      'Invalid request; error.code and correlationId identify the failure.',
  })
  @ApiResponse({
    status: 503,
    description: 'A required service is temporarily unavailable.',
  })
  class GatewayController {
    @Get('live')
    live() {
      return { status: 'ok' };
    }

    @Get('ready')
    async ready(@Res() response: Response) {
      const ready = await readiness().catch(() => false);
      return response
        .status(ready ? 200 : 503)
        .json({ status: ready ? 'ready' : 'unavailable' });
    }

    @Get('metrics')
    async metrics(@Res() response: Response) {
      response.setHeader('content-type', registry.contentType);
      response.send((await registry.metrics()) + (await rpcRegistry.metrics()));
    }

    @Post('v1/auth/register')
    @HttpCode(202)
    @ApiOperation({
      summary:
        'Register an ordinary user; profile creation completes asynchronously.',
    })
    @ApiBody({ schema: credentialsBody })
    @ApiResponse({
      status: 202,
      description:
        'Pending identity: {id, state}. Retry login while profile creation is pending.',
    })
    @ApiResponse({
      status: 429,
      description: 'Too many authentication attempts; observe Retry-After.',
    })
    async register(@Body() body: unknown, @Req() request: CorrelatedRequest) {
      enforceAuthRateLimit(request);
      return clients.auth.register(
        parse(registrationSchema, body),
        request.correlationId,
      );
    }

    @Post('v1/auth/login')
    @HttpCode(200)
    @ApiOperation({
      summary: 'Issue a 15-minute access token for an active identity.',
    })
    @ApiBody({
      schema: {
        ...credentialsBody,
        properties: {
          ...credentialsBody.properties,
          password: { ...credentialsBody.properties.password, minLength: 1 },
        },
      },
    })
    @ApiResponse({
      status: 429,
      description: 'Too many authentication attempts; observe Retry-After.',
    })
    async login(@Body() body: unknown, @Req() request: CorrelatedRequest) {
      enforceAuthRateLimit(request);
      return clients.auth.login(
        parse(loginSchema, body),
        request.correlationId,
      );
    }

    @Get('v1/users/me')
    @ApiBearerAuth()
    async me(@Req() request: CorrelatedRequest) {
      const { id } = await principal(request);
      return clients.users.getUser({ id }, request.correlationId);
    }

    @Get('v1/users/me/ledger')
    @ApiBearerAuth()
    @ApiQuery({
      name: 'cursor',
      required: false,
      type: String,
      description:
        'Sequence cursor from nextCursor; omit for the first 100 entries.',
    })
    async ledger(@Req() request: CorrelatedRequest) {
      const input = parse(
        z
          .object({
            cursor: z
              .string()
              .regex(/^(0|[1-9][0-9]{0,18})$/)
              .refine(
                (value) => value.length < 19 || value <= MAX_POINTS.toString(),
              )
              .optional(),
          })
          .strict(),
        request.query,
      );
      const { id } = await principal(request);
      return clients.users.getLedger({ id, ...input }, request.correlationId);
    }

    @Post('v1/bets')
    @HttpCode(202)
    @ApiBearerAuth()
    @ApiBody({ schema: pointsBody })
    @ApiHeader(idempotencyHeader)
    @ApiResponse({
      status: 202,
      description: 'Durable bet intent. Poll GET /v1/bets/{id} for settlement.',
    })
    async submit(@Body() body: unknown, @Req() request: CorrelatedRequest) {
      const { amount } = parse(amountSchema, body);
      const key = parse(keySchema, request.header('idempotency-key'));
      const { id: userId } = await principal(request);
      return clients.bets.submit(
        { userId, amount, key },
        request.correlationId,
      );
    }

    @Get('v1/bets/:id')
    @ApiBearerAuth()
    async bet(@Param('id') id: string, @Req() request: CorrelatedRequest) {
      const betId = parse(idSchema, id);
      const { id: userId } = await principal(request);
      return clients.bets.getBet({ id: betId, userId }, request.correlationId);
    }

    @Get('v1/pool')
    pool(@Req() request: CorrelatedRequest) {
      return clients.jackpot.getPool({}, request.correlationId);
    }

    @Post('v1/admin/users/:id/credits')
    @HttpCode(200)
    @ApiBearerAuth()
    @ApiOperation({
      summary: 'Admin only: credit synthetic points to an account.',
    })
    @ApiBody({ schema: pointsBody })
    @ApiHeader(idempotencyHeader)
    async credit(
      @Param('id') id: string,
      @Body() body: unknown,
      @Req() request: CorrelatedRequest,
    ) {
      const targetId = parse(idSchema, id);
      const { amount } = parse(amountSchema, body);
      const key = parse(keySchema, request.header('idempotency-key'));
      const caller = await principal(request);
      const user = await clients.users.getUser(
        { id: caller.id },
        request.correlationId,
      );
      if (user.role !== 'admin')
        throw new DomainError(
          'PERMISSION_DENIED',
          'Administrator role is required',
        );
      return clients.users.credit(
        { id: targetId, amount, key },
        request.correlationId,
      );
    }
  }

  @Module({ controllers: [GatewayController] })
  class GatewayModule {}

  const app = await NestFactory.create(GatewayModule, {
    logger: false,
    bodyParser: false,
  });
  const server = app.getHttpAdapter().getInstance() as {
    disable: (setting: string) => void;
  };
  server.disable('x-powered-by');
  app.use(
    (request: CorrelatedRequest, response: Response, next: NextFunction) => {
      const supplied = request.header('x-correlation-id');
      request.correlationId =
        supplied && idSchema.safeParse(supplied).success
          ? supplied
          : randomUUID();
      response.setHeader('x-correlation-id', request.correlationId);
      response.setHeader('x-content-type-options', 'nosniff');
      response.setHeader('x-frame-options', 'DENY');
      response.setHeader('cache-control', 'no-store');
      const started = process.hrtime.bigint();
      const method = [
        'GET',
        'POST',
        'PATCH',
        'PUT',
        'DELETE',
        'OPTIONS',
        'HEAD',
      ].includes(request.method)
        ? request.method
        : 'OTHER';
      void withSpan(
        `HTTP ${method}`,
        request.correlationId,
        () =>
          new Promise<void>((resolve) => {
            response.once('close', resolve);
            response.once('finish', () => {
              const route =
                typeof request.route?.path === 'string'
                  ? request.route.path
                  : 'unmatched';
              const seconds = Number(process.hrtime.bigint() - started) / 1e9;
              requests.inc({
                method,
                route,
                status: String(response.statusCode),
              });
              durations.observe({ method, route }, seconds);
              log.info(
                {
                  method,
                  route,
                  status: response.statusCode,
                  durationMs: seconds * 1000,
                  correlationId: request.correlationId,
                },
                'HTTP request completed',
              );
              resolve();
            });
            next();
          }),
        request.header('traceparent'),
      ).catch(() => {
        log.error(
          { correlationId: request.correlationId },
          'HTTP tracing failed',
        );
      });
    },
  );
  app.use(json({ limit: '16kb', strict: true }));
  app.useGlobalFilters(new ApiExceptionFilter());
  const config = new DocumentBuilder()
    .setTitle('Synthetic points jackpot simulator')
    .setDescription(
      'Portfolio reference. Synthetic integer points only; no real money. Authentication tokens expire after 15 minutes. Commands require an Idempotency-Key header.',
    )
    .setVersion('1')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
  return app;
}
