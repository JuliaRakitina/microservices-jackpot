import { z } from 'zod';
const secret = z
  .string()
  .min(32)
  .refine(
    (v) =>
      !/change|secret|password|example|demo|placeholder|^(.)(\1)+$/i.test(v),
    'Use a generated random secret',
  );
const url = z.string().url();
export function config(env: NodeJS.ProcessEnv = process.env) {
  const service = z
    .enum(['gateway', 'auth', 'users', 'bets', 'jackpot'])
    .parse(env.SERVICE_NAME);
  const internalToken = secret.parse(env.INTERNAL_TOKEN);
  const jwtSecret =
    service === 'auth' ? secret.parse(env.JWT_SECRET) : undefined;
  const databaseUrl =
    service === 'gateway' ? undefined : url.parse(env.DATABASE_URL);
  if (databaseUrl)
    secret.parse(decodeURIComponent(new URL(databaseUrl).password));
  const brokerUrl =
    service === 'gateway' ? undefined : url.parse(env.BROKER_URL);
  if (brokerUrl) secret.parse(decodeURIComponent(new URL(brokerUrl).password));
  return {
    service,
    internalToken,
    jwtSecret,
    databaseUrl,
    brokerUrl,
    httpPort: z.coerce
      .number()
      .int()
      .min(1)
      .max(65535)
      .parse(env.HTTP_PORT ?? '3000'),
    grpcPort: z.coerce
      .number()
      .int()
      .min(1)
      .max(65535)
      .parse(env.GRPC_PORT ?? '50051'),
    addresses: {
      auth: env.AUTH_ADDR ?? 'auth:50051',
      users: env.USERS_ADDR ?? 'users:50051',
      bets: env.BETS_ADDR ?? 'bets:50051',
      jackpot: env.JACKPOT_ADDR ?? 'jackpot:50051',
    },
  };
}
