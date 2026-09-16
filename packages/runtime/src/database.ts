import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import type {
  DomainEvent,
  EventType,
  EventPayload,
} from '../../contracts/src/events.js';
import { traceHeader } from '../../observability/src/index.js';
import { DomainError } from '../../contracts/src/errors.js';

const infrastructure = `
CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS outbox (id uuid PRIMARY KEY, event jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz, attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS outbox_pending ON outbox(available_at,created_at) WHERE published_at IS NULL;
CREATE TABLE IF NOT EXISTS inbox (id uuid PRIMARY KEY, event jsonb NOT NULL, processed_at timestamptz NOT NULL DEFAULT now());
`;
export class Transaction {
  constructor(private readonly manager: EntityManager) {}
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters: unknown[] = [],
  ): Promise<T[]> {
    return this.manager.query(sql, parameters) as Promise<T[]>;
  }
  async emit(
    type: EventType,
    payload: EventPayload,
    correlationId: string,
  ): Promise<void> {
    const event: DomainEvent = {
      id: randomUUID(),
      type,
      payload,
      correlationId,
      occurredAt: new Date().toISOString(),
      traceparent: traceHeader(),
    };
    await this.query('INSERT INTO outbox(id,event) VALUES ($1,$2)', [
      event.id,
      JSON.stringify(event),
    ]);
  }
}
export class Database {
  readonly source: DataSource;
  constructor(databaseUrl: string) {
    this.source = new DataSource({
      type: 'postgres',
      url: databaseUrl,
      synchronize: false,
      logging: false,
      extra: {
        max: 12,
        connectionTimeoutMillis: 3000,
        statement_timeout: 10000,
        idle_in_transaction_session_timeout: 15000,
      },
    });
  }
  async connect() {
    if (!this.source.isInitialized) await this.source.initialize();
  }
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters: unknown[] = [],
  ): Promise<T[]> {
    return this.source.query(sql, parameters) as Promise<T[]>;
  }
  transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.source.transaction((manager) => fn(new Transaction(manager)));
  }
  async migrate(sql: string): Promise<void> {
    await this.connect();
    await this.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(2026091601)');
      await tx.query(infrastructure);
      const applied = await tx.query(
        'SELECT version FROM schema_migrations WHERE version=1',
      );
      if (applied.length === 0) {
        await tx.query(sql);
        await tx.query('INSERT INTO schema_migrations(version) VALUES (1)');
      }
    });
  }
  async consume(
    event: DomainEvent,
    handler: (event: DomainEvent, tx: Transaction) => Promise<void>,
  ): Promise<void> {
    await this.transaction(async (tx) => {
      const serialized = JSON.stringify(event);
      const inserted = await tx.query(
        'INSERT INTO inbox(id,event) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING id',
        [event.id, serialized],
      );
      if (inserted.length) await handler(event, tx);
      else {
        const same = await tx.query(
          'SELECT id FROM inbox WHERE id=$1 AND event=$2::jsonb',
          [event.id, serialized],
        );
        if (!same.length)
          throw new DomainError(
            'ALREADY_EXISTS',
            'Event ID was reused with different content',
          );
      }
    });
  }
  async ready(): Promise<boolean> {
    try {
      await this.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
  async close() {
    if (this.source.isInitialized) await this.source.destroy();
  }
}
