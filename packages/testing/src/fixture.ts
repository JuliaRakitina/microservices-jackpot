import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { AuthService } from '../../../apps/auth/src/service.js';
import { migration as authMigration } from '../../../apps/auth/src/migration.js';
import { UsersService } from '../../../apps/users/src/service.js';
import { migration as usersMigration } from '../../../apps/users/src/migration.js';
import { BetsService } from '../../../apps/bets/src/service.js';
import { migration as betsMigration } from '../../../apps/bets/src/migration.js';
import {
  JackpotService,
  type WinnerSelector,
} from '../../../apps/jackpot/src/service.js';
import { migration as jackpotMigration } from '../../../apps/jackpot/src/migration.js';
import { Database } from '../../runtime/src/database.js';
import { EventBus } from '../../runtime/src/bus.js';
import type {
  DomainEvent,
  EventPayload,
  EventType,
} from '../../contracts/src/events.js';

type Name = 'auth' | 'users' | 'bets' | 'jackpot';
const names: Name[] = ['auth', 'users', 'bets', 'jackpot'];

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Unable to allocate a test port');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}
export const migrations = {
  auth: authMigration,
  users: usersMigration,
  bets: betsMigration,
  jackpot: jackpotMigration,
};

/** Arguments never include generated credentials. Docker inherits those through env. */
export function docker(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'docker',
      args,
      { env, timeout: 180_000, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout) => {
        if (error)
          reject(
            new Error(
              `Docker ${args[0] ?? 'command'} failed (exit ${error.code ?? 'unknown'}); verify the Docker engine and required images`,
            ),
          );
        else resolve(stdout.trim());
      },
    );
  });
}

export async function eventually(
  predicate: () => Promise<boolean>,
  options: { timeoutMs?: number; message?: string } = {},
) {
  const deadline = Date.now() + (options.timeoutMs ?? 30_000);
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return;
    } catch (error) {
      lastError = error;
    }
    await delay(75);
  }
  throw new Error(
    options.message ?? 'Condition did not become true before the deadline',
    { cause: lastError },
  );
}

export function event(type: EventType, payload: EventPayload): DomainEvent {
  return {
    id: randomUUID(),
    type,
    payload,
    correlationId: randomUUID(),
    occurredAt: new Date().toISOString(),
  };
}

export interface Fixture {
  dbs: Record<Name, Database>;
  dbUrls: Record<Name, string>;
  services: {
    auth: AuthService;
    users: UsersService;
    bets: BetsService;
    jackpot: JackpotService;
  };
  buses: Record<Name, EventBus>;
  jwtSecret: string;
  brokerUrl: string;
  postgresContainer: string;
  brokerContainer: string;
  close(): Promise<void>;
}

export async function createFixture(
  options: { selector?: WinnerSelector; startBuses?: boolean } = {},
): Promise<Fixture> {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const postgresContainer = `jackpot-test-pg-${suffix}`;
  const brokerContainer = `jackpot-test-rabbit-${suffix}`;
  const password = randomBytes(32).toString('hex');
  const brokerPassword = randomBytes(32).toString('hex');
  const jwtSecret = randomBytes(32).toString('hex');
  const pgPort = await freePort();
  let rabbitPort = await freePort();
  while (rabbitPort === pgPort) rabbitPort = await freePort();
  const dbs = {} as Record<Name, Database>;
  const buses = {} as Record<Name, EventBus>;
  const dbUrls = {} as Record<Name, string>;
  const ownedContainers: string[] = [];
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await Promise.allSettled(Object.values(buses).map((bus) => bus.stop()));
    await Promise.allSettled(Object.values(dbs).map((db) => db.close()));
    // Only exact names created by this fixture are removed; never prune the host.
    await Promise.allSettled(
      ownedContainers.map((container) =>
        docker(['rm', '--force', '--volumes', container]),
      ),
    );
  };
  try {
    await docker(['info', '--format', '{{.ServerVersion}}']);
    await docker(
      [
        'run',
        '--detach',
        '--name',
        postgresContainer,
        '--label',
        'jackpot.test=true',
        '--publish',
        `127.0.0.1:${pgPort}:5432`,
        '--env',
        'POSTGRES_PASSWORD',
        '--health-cmd',
        'pg_isready -U postgres',
        '--health-interval',
        '1s',
        '--health-timeout',
        '3s',
        '--health-retries',
        '90',
        'postgres:17.11-bookworm',
      ],
      { ...process.env, POSTGRES_PASSWORD: password },
    );
    ownedContainers.push(postgresContainer);
    await docker(
      [
        'run',
        '--detach',
        '--name',
        brokerContainer,
        '--hostname',
        brokerContainer,
        '--label',
        'jackpot.test=true',
        '--publish',
        `127.0.0.1:${rabbitPort}:5672`,
        '--env',
        'RABBITMQ_DEFAULT_USER',
        '--env',
        'RABBITMQ_DEFAULT_PASS',
        '--health-cmd',
        'rabbitmq-diagnostics -q ping',
        '--health-interval',
        '2s',
        '--health-timeout',
        '5s',
        '--health-retries',
        '90',
        'rabbitmq:4.3.5-management',
      ],
      {
        ...process.env,
        RABBITMQ_DEFAULT_USER: 'jackpot_test',
        RABBITMQ_DEFAULT_PASS: brokerPassword,
      },
    );
    ownedContainers.push(brokerContainer);
    await Promise.all(
      ownedContainers.map((container) =>
        eventually(
          async () =>
            (await docker([
              'inspect',
              '--format',
              '{{.State.Health.Status}}',
              container,
            ])) === 'healthy',
          {
            timeoutMs: 180_000,
            message: `Test container ${container} did not become healthy`,
          },
        ),
      ),
    );
    const brokerUrl = `amqp://jackpot_test:${brokerPassword}@127.0.0.1:${rabbitPort}`;
    const admin = new pg.Client({
      host: '127.0.0.1',
      port: Number(pgPort),
      user: 'postgres',
      password,
      database: 'postgres',
    });
    try {
      await admin.connect();
      for (const name of names) {
        const credential = randomBytes(32).toString('hex');
        // Names come from the fixed local enum; password is hex generated above.
        await admin.query(
          `CREATE ROLE ${name}_service LOGIN PASSWORD '${credential}'`,
        );
        await admin.query(`CREATE DATABASE ${name} OWNER ${name}_service`);
        await admin.query(`REVOKE ALL ON DATABASE ${name} FROM PUBLIC`);
        dbUrls[name] =
          `postgresql://${name}_service:${credential}@127.0.0.1:${pgPort}/${name}`;
        dbs[name] = new Database(dbUrls[name]);
        await dbs[name].migrate(migrations[name]);
      }
    } finally {
      await admin.end();
    }
    const services = {
      auth: new AuthService(dbs.auth, jwtSecret),
      users: new UsersService(dbs.users),
      bets: new BetsService(dbs.bets),
      jackpot: new JackpotService(
        dbs.jackpot,
        options.selector ?? (() => ({ won: false, draw: 1 })),
      ),
    };
    for (const name of names)
      buses[name] = new EventBus(name, brokerUrl, dbs[name], (message, tx) =>
        services[name].handle(message, tx),
      );
    if (options.startBuses !== false) {
      for (const name of names) await buses[name].start();
      await eventually(
        async () =>
          (
            await Promise.all(Object.values(buses).map((bus) => bus.ready()))
          ).every(Boolean),
        {
          timeoutMs: 30_000,
          message: 'Test event consumers did not become ready',
        },
      );
    }
    return {
      dbs,
      dbUrls,
      services,
      buses,
      jwtSecret,
      brokerUrl,
      postgresContainer,
      brokerContainer,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
