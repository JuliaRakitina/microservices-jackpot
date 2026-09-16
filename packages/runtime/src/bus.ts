import amqp, {
  type ChannelModel,
  type ConfirmChannel,
  type ConsumeMessage,
} from 'amqplib';
import { randomUUID } from 'node:crypto';
import { Registry, Counter, Gauge, Histogram } from '@prometheus-io/client';
import { DomainError, parse } from '../../contracts/src/errors.js';
import {
  eventSchema,
  type DomainEvent,
  type EventType,
} from '../../contracts/src/events.js';
import { logger, withSpan } from '../../observability/src/index.js';
import type { Database, Transaction } from './database.js';

// The sole routing map: used both to declare durable queues and admit deliveries.
export const subscriptions: Readonly<Record<string, readonly EventType[]>> = {
  auth: ['profile.created'],
  users: ['identity.registered', 'bet.requested', 'bet.settled'],
  bets: ['funds.reserved', 'funds.rejected', 'payout.applied'],
  jackpot: ['bet.accepted'],
};
const retryDelays = [500, 1000, 2000, 4000, 8000];
export class EventBus {
  private connection?: ChannelModel;
  private channel?: ConfirmChannel;
  private timer?: NodeJS.Timeout;
  private stopped = false;
  private connecting?: Promise<void>;
  private publishing?: Promise<void>;
  private stopping?: Promise<void>;
  private readonly closing = new WeakMap<ChannelModel, Promise<void>>();
  private consumerTag?: string;
  private readonly inflight = new Set<Promise<void>>();
  private readonly log;
  readonly registry = new Registry();
  private readonly failures;
  private readonly backlog;
  private readonly lag;
  private readonly outcomes;
  private readonly latency;
  constructor(
    private readonly name: string,
    private readonly url: string,
    private readonly db: Database,
    private readonly handle: (
      event: DomainEvent,
      tx: Transaction,
    ) => Promise<void>,
  ) {
    this.log = logger(name);
    this.failures = new Counter({
      name: 'consumer_failures_total',
      help: 'Failed delivery attempts',
      labelNames: ['type'],
      registers: [this.registry],
    });
    this.backlog = new Gauge({
      name: 'outbox_pending',
      help: 'Unpublished durable events',
      registers: [this.registry],
    });
    this.lag = new Gauge({
      name: 'consumer_event_age_seconds',
      help: 'Age of most recently handled event',
      registers: [this.registry],
    });
    this.outcomes = new Counter({
      name: 'settlement_deliveries_total',
      help: 'Successfully handled payout.applied deliveries, including deduplicated redeliveries',
      labelNames: ['outcome'],
      registers: [this.registry],
    });
    this.latency = new Histogram({
      name: 'event_processing_seconds',
      help: 'Database event handling latency',
      labelNames: ['type'],
      registers: [this.registry],
    });
  }
  async start() {
    if (this.stopping) await this.stopping;
    this.stopped = false;
    await this.connect();
    this.schedule();
  }
  private schedule() {
    if (this.stopped) return;
    this.timer = setTimeout(async () => {
      try {
        if (!this.channel) await this.connect();
        if (!this.stopped && this.channel) await this.publishOutbox();
      } catch {
        this.log.warn(
          { event: 'outbox_retry' },
          'Durable publication will retry',
        );
      } finally {
        this.schedule();
      }
    }, 250);
    this.timer.unref();
  }
  private async connect() {
    if (this.stopped) return;
    if (this.connecting) return this.connecting;
    const work = this.openConnection();
    this.connecting = work;
    try {
      await work;
    } finally {
      if (this.connecting === work) this.connecting = undefined;
    }
  }
  private async openConnection() {
    let connection: ChannelModel | undefined;
    try {
      connection = await amqp.connect(this.url, { timeout: 3000 });
      const current = connection;
      connection.on('error', () =>
        this.log.warn(
          { event: 'broker_connection_error' },
          'Broker unavailable',
        ),
      );
      if (this.stopped) {
        await this.closeConnection(connection);
        return;
      }
      this.connection = connection;
      connection.on('close', () => {
        if (this.connection === current) {
          this.channel = undefined;
          this.connection = undefined;
          this.consumerTag = undefined;
        }
      });
      const channel = await connection.createConfirmChannel();
      channel.on('error', () =>
        this.log.warn(
          { event: 'broker_channel_error' },
          'Broker channel unavailable',
        ),
      );
      channel.on('close', () => {
        if (this.channel === channel) this.channel = undefined;
        void this.closeConnection(current);
      });
      if (this.stopped) {
        await this.closeConnection(connection);
        return;
      }
      await channel.assertExchange('jackpot.events', 'topic', {
        durable: true,
      });
      // Declare every durable route before any service is allowed to publish.
      for (const [service, types] of Object.entries(subscriptions)) {
        const queue = `jackpot.${service}`;
        await channel.assertQueue(queue, {
          durable: true,
          arguments: { 'x-queue-type': 'quorum', 'x-delivery-limit': -1 },
        });
        await channel.assertQueue(`${queue}.failed`, {
          durable: true,
          arguments: { 'x-queue-type': 'quorum' },
        });
        for (const type of types)
          await channel.bindQueue(queue, 'jackpot.events', type);
        for (const [index, delay] of retryDelays.entries())
          await channel.assertQueue(`${queue}.retry.${index}`, {
            durable: true,
            arguments: {
              'x-queue-type': 'quorum',
              'x-message-ttl': delay,
              'x-dead-letter-exchange': '',
              'x-dead-letter-routing-key': queue,
              'x-dead-letter-strategy': 'at-least-once',
              'x-overflow': 'reject-publish',
            },
          });
      }
      await channel.prefetch(8);
      if (this.stopped) {
        await this.closeConnection(connection);
        return;
      }
      this.channel = channel;
      const consumer = await channel.consume(
        `jackpot.${this.name}`,
        (message) => {
          if (!message) {
            void this.closeConnection(current);
            return;
          }
          const work = this.consume(channel, message).catch(async () => {
            this.log.warn(
              { event: 'delivery_disconnected' },
              'Closing connection to redeliver unacknowledged work',
            );
            // A failed retry publication leaves the original delivery unacknowledged.
            // Closing releases broker prefetch capacity and guarantees redelivery.
            await this.closeConnection(current);
          });
          this.inflight.add(work);
          void work.finally(() => this.inflight.delete(work));
        },
        { noAck: false },
      );
      this.consumerTag = consumer.consumerTag;
      if (this.stopped) {
        await this.closeConnection(connection);
        return;
      }
      this.log.info({ event: 'broker_connected' }, 'Consumer ready');
    } catch {
      if (connection) await this.closeConnection(connection);
      if (this.connection === connection) {
        this.channel = undefined;
        this.connection = undefined;
      }
      this.log.warn({ event: 'broker_retry' }, 'Waiting for broker');
    }
  }
  private closeConnection(connection: ChannelModel): Promise<void> {
    const pending = this.closing.get(connection);
    if (pending) return pending;
    const closing = new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timeout);
        connection.off('close', done);
        resolve();
      };
      const timeout = setTimeout(() => {
        // amqplib has no public force-close API. Its exposed connection owns the
        // transport; destroy it only if the graceful broker handshake times out.
        const transport =
          connection.connection as typeof connection.connection & {
            stream?: { destroy(error?: Error): void };
          };
        transport.stream?.destroy(
          new Error('Broker shutdown deadline exceeded'),
        );
        done();
      }, 2000);
      connection.once('close', done);
      void Promise.resolve()
        .then(() => connection.close())
        .then(done, done);
    });
    this.closing.set(connection, closing);
    return closing;
  }
  private confirmed(
    channel: ConfirmChannel,
    destination: string,
    body: Buffer,
    exchange = '',
    headers: Record<string, unknown> = {},
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const messageId = randomUUID();
      const finish = (error?: Error | null) => {
        clearTimeout(timeout);
        channel.off('return', returned);
        if (error) reject(error);
        else resolve();
      };
      const returned = (message: ConsumeMessage) => {
        if (message.properties.messageId === messageId)
          finish(new Error('Publication had no durable route'));
      };
      const timeout = setTimeout(
        () => finish(new Error('Publish confirmation timed out')),
        5000,
      );
      channel.on('return', returned);
      try {
        channel.publish(
          exchange,
          destination,
          body,
          {
            persistent: true,
            mandatory: true,
            messageId,
            contentType: 'application/json',
            headers,
          },
          (error) => finish(error),
        );
      } catch (error) {
        finish(
          error instanceof Error ? error : new Error('Publication failed'),
        );
      }
    });
  }
  async publish(event: DomainEvent) {
    if (!this.channel || this.stopped)
      throw new DomainError('UNAVAILABLE', 'Broker unavailable');
    const connection = this.connection;
    try {
      await this.confirmed(
        this.channel,
        event.type,
        Buffer.from(JSON.stringify(event)),
        'jackpot.events',
      );
    } catch (error) {
      if (connection) await this.closeConnection(connection);
      throw error;
    }
  }
  private async consume(channel: ConfirmChannel, message: ConsumeMessage) {
    let event: DomainEvent | undefined;
    try {
      event = parse(
        eventSchema,
        JSON.parse(message.content.toString()) as unknown,
      );
      if (!subscriptions[this.name]?.includes(event.type))
        throw new DomainError('INVALID_ARGUMENT', 'Unexpected event type');
      const valid = event;
      const stop = this.latency.startTimer({ type: valid.type });
      try {
        await withSpan(
          `event.${valid.type}`,
          valid.correlationId,
          () => this.db.consume(valid, this.handle),
          valid.traceparent,
        );
      } finally {
        stop();
      }
      this.lag.set(
        Math.max(0, (Date.now() - Date.parse(valid.occurredAt)) / 1000),
      );
      this.log.info(
        {
          eventId: valid.id,
          correlationId: valid.correlationId,
          type: valid.type,
          event: 'event_processed',
        },
        'Event committed',
      );
      if (valid.type === 'payout.applied')
        this.outcomes.inc({ outcome: valid.payload.won ? 'won' : 'lost' });
      channel.ack(message);
    } catch (error) {
      this.failures.inc({ type: event?.type ?? 'invalid' });
      const attempt = Number(message.properties.headers?.attempt ?? 0);
      const retry =
        Number.isInteger(attempt) &&
        attempt >= 0 &&
        attempt < retryDelays.length;
      const target = retry
        ? `jackpot.${this.name}.retry.${attempt}`
        : `jackpot.${this.name}.failed`;
      await this.confirmed(channel, target, message.content, '', {
        attempt: attempt + 1,
        failure: error instanceof DomainError ? error.code : 'INTERNAL',
      });
      channel.ack(message);
      this.log.warn(
        {
          eventId: event?.id,
          correlationId: event?.correlationId,
          event: retry ? 'consumer_retry' : 'consumer_parked',
          attempt: attempt + 1,
        },
        'Delivery retained for recovery',
      );
    }
  }
  async publishOutbox() {
    if (!this.channel || this.stopped) return;
    if (this.publishing) return this.publishing;
    const work = this.drainOutbox();
    this.publishing = work;
    try {
      await work;
    } finally {
      if (this.publishing === work) this.publishing = undefined;
    }
  }
  private async drainOutbox() {
    for (let i = 0; i < 32 && !this.stopped; i++) {
      let id: unknown;
      try {
        const found = await this.db.transaction(async (tx) => {
          const rows = await tx.query(
            'SELECT id,event FROM outbox WHERE published_at IS NULL AND available_at<=now() ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED',
          );
          const row = rows[0];
          if (!row) return false;
          id = row.id;
          await this.publish(parse(eventSchema, row.event));
          await tx.query('UPDATE outbox SET published_at=now() WHERE id=$1', [
            id,
          ]);
          return true;
        });
        if (!found) break;
      } catch (error) {
        if (id && !this.stopped)
          await this.db.query(
            "UPDATE outbox SET attempts=attempts+1,available_at=now()+least(30,power(2,least(attempts,5))) * interval '1 second' WHERE id=$1 AND published_at IS NULL",
            [id],
          );
        throw error;
      }
    }
    const rows = await this.db.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM outbox WHERE published_at IS NULL',
    );
    this.backlog.set(Number(rows[0]?.count ?? 0));
  }
  async ready(): Promise<boolean> {
    try {
      if (this.stopped || !this.channel) return false;
      await this.channel.checkQueue(`jackpot.${this.name}`);
      return true;
    } catch {
      return false;
    }
  }
  async stop() {
    if (this.stopping) return this.stopping;
    this.stopped = true;
    clearTimeout(this.timer);
    const work = this.drainAndClose();
    this.stopping = work;
    try {
      await work;
    } finally {
      if (this.stopping === work) this.stopping = undefined;
    }
  }
  private async drainAndClose() {
    // A topology RPC can itself be waiting for a stalled broker. Closing the
    // provisional connection releases that await before we join its task.
    if (this.connecting && this.connection) {
      await this.closeConnection(this.connection);
    }
    await this.connecting;
    const connection = this.connection;
    if (this.consumerTag && this.channel) {
      let timeout: NodeJS.Timeout | undefined;
      await Promise.race([
        this.channel.cancel(this.consumerTag).catch(() => undefined),
        new Promise<void>((resolve) => {
          timeout = setTimeout(() => {
            void (
              connection ? this.closeConnection(connection) : Promise.resolve()
            ).then(resolve);
          }, 1000);
        }),
      ]);
      clearTimeout(timeout);
    }
    await Promise.allSettled([...this.inflight]);
    if (connection) await this.closeConnection(connection);
    await this.publishing?.catch(() => undefined);
    this.channel = undefined;
    this.connection = undefined;
    this.consumerTag = undefined;
  }
}
