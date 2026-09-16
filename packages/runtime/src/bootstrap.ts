import type { Server } from '@grpc/grpc-js';
import { config } from '../../config/src/index.js';
import { serveRpc, rpcRegistry } from '../../contracts/src/rpc.js';
import { Registry } from '@prometheus-io/client';
import {
  logger,
  startTracing,
  stopTracing,
} from '../../observability/src/index.js';
import { Database, type Transaction } from './database.js';
import { EventBus } from './bus.js';
import { healthServer } from './health.js';
import type { DomainEvent } from '../../contracts/src/events.js';

interface DomainService {
  handle(event: DomainEvent, tx: Transaction): Promise<void>;
  metrics?: Registry;
}
export async function bootstrap(
  migration: string,
  create: (db: Database) => DomainService,
) {
  const settings = config();
  if (
    settings.service === 'gateway' ||
    !settings.databaseUrl ||
    !settings.brokerUrl
  )
    throw new Error('Invalid service bootstrap');
  const serviceName = settings.service;
  startTracing();
  const log = logger(settings.service);
  const db = new Database(settings.databaseUrl);
  const service = create(db);
  const bus = new EventBus(
    settings.service,
    settings.brokerUrl,
    db,
    service.handle.bind(service),
  );
  let initialized = false;
  let shuttingDown = false;
  let rpc: Server | undefined;
  let startup: Promise<void> | undefined;
  let stopping: Promise<void> | undefined;
  const health = await healthServer(
    settings.httpPort,
    async () =>
      initialized && !shuttingDown && (await db.ready()) && (await bus.ready()),
    Registry.merge([
      bus.registry,
      rpcRegistry,
      ...(service.metrics ? [service.metrics] : []),
    ]),
  );
  const shutdown = async () => {
    if (stopping) return stopping;
    shuttingDown = true;
    stopping = (async () => {
      const deadline = setTimeout(() => process.exit(1), 15000);
      deadline.unref();
      const stoppingBus = bus.stop();
      // Startup owns each resource until its awaited creation finishes. Its
      // guards prevent a signal during migration from opening fresh listeners.
      await startup?.catch(() => undefined);
      if (rpc)
        await new Promise<void>((resolve) => rpc!.tryShutdown(() => resolve()));
      await stoppingBus;
      await db.close();
      await health.close();
      await stopTracing();
      clearTimeout(deadline);
    })();
    return stopping;
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
  try {
    startup = (async () => {
      await db.migrate(migration);
      if (shuttingDown) return;
      rpc = await serveRpc(
        serviceName,
        service,
        settings.internalToken,
        settings.grpcPort,
      );
      if (shuttingDown) return;
      await bus.start();
      if (shuttingDown) return;
      initialized = true;
      log.info(
        { event: 'service_started' },
        'Migrations complete; service listening',
      );
    })();
    await startup;
  } catch (error) {
    log.error(
      {
        event: 'startup_failed',
        errorType: error instanceof Error ? error.name : 'unknown',
      },
      'Startup failed',
    );
    await shutdown();
    process.exitCode = 1;
  }
}
