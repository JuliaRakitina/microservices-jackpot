import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { setImmediate as nextTurn } from 'node:timers/promises';
import test from 'node:test';
import amqp, {
  type ChannelModel,
  type ConsumeMessage,
  type Options,
} from 'amqplib';
import { EventBus, subscriptions } from '../../packages/runtime/src/bus.js';
import type { Database } from '../../packages/runtime/src/database.js';
import {
  eventTypes,
  type DomainEvent,
} from '../../packages/contracts/src/events.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function event(): DomainEvent {
  return {
    id: randomUUID(),
    type: 'profile.created',
    schemaVersion: 1,
    correlationId: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: { id: randomUUID() },
  };
}

function broker(
  options: {
    publish?: (
      channel: EventEmitter,
      properties: Options.Publish,
      done: (error: Error | null) => void,
    ) => void;
    hangOnClose?: boolean;
    onConsume?: () => void;
  } = {},
) {
  let deliver: ((message: ConsumeMessage | null) => void) | undefined;
  const bindings: { queue: string; exchange: string; type: string }[] = [];
  const publications: {
    exchange: string;
    routingKey: string;
    body: Buffer;
    properties: Options.Publish;
  }[] = [];
  let consumers = 0,
    acknowledgments = 0,
    closes = 0,
    destroyed = 0;
  const channel = Object.assign(new EventEmitter(), {
    assertExchange: async () => {},
    assertQueue: async () => {},
    bindQueue: async (queue: string, exchange: string, type: string) => {
      bindings.push({ queue, exchange, type });
    },
    prefetch: async () => {},
    consume: async (_queue: string, callback: typeof deliver) => {
      consumers++;
      deliver = callback;
      options.onConsume?.();
      return { consumerTag: 'consumer' };
    },
    cancel: async () => {},
    checkQueue: async () => ({}),
    ack: () => {
      acknowledgments++;
    },
    publish: (
      exchange: string,
      routingKey: string,
      body: Buffer,
      properties: Options.Publish,
      done: (error: Error | null) => void,
    ) => {
      publications.push({ exchange, routingKey, body, properties });
      if (options.publish) options.publish(channel, properties, done);
      else done(null);
      return true;
    },
  });
  const connection = Object.assign(new EventEmitter(), {
    createConfirmChannel: async () => channel,
    connection: {
      stream: {
        destroy: () => {
          destroyed++;
          channel.emit('close');
          connection.emit('close');
        },
      },
    },
    close: async () => {
      closes++;
      if (options.hangOnClose) await new Promise<void>(() => {});
      channel.emit('close');
      connection.emit('close');
    },
  });
  return {
    connection: connection as unknown as ChannelModel,
    bindings,
    publications,
    get consumers() {
      return consumers;
    },
    get acknowledgments() {
      return acknowledgments;
    },
    get closes() {
      return closes;
    },
    get destroyed() {
      return destroyed;
    },
    deliver(value: unknown, headers: Record<string, unknown> = {}) {
      assert.ok(deliver);
      deliver({
        content: Buffer.from(JSON.stringify(value)),
        properties: { headers },
      } as ConsumeMessage);
    },
  };
}

function database(consume: Database['consume'] = async () => {}) {
  return {
    consume,
    query: async () => [{ count: '0' }],
    transaction: async (handler: (tx: unknown) => Promise<unknown>) =>
      handler({ query: async () => [] }),
  } as unknown as Database;
}

test('consumer validates payload, event type and schema version before database access', async (t) => {
  const fake = broker();
  let consumed = 0;
  let handled = 0;
  t.mock.method(amqp, 'connect', async () => fake.connection);
  const bus = new EventBus(
    'auth',
    'amqp://test',
    database(async () => {
      consumed++;
    }),
    async () => {
      handled++;
    },
  );
  t.after(() => bus.stop());
  await bus.start();
  const valid = event();
  const { schemaVersion: _version, ...missingVersion } = valid;
  const invalid: Record<string, unknown> = {
    'missing payload field': { ...valid, payload: {} },
    'invalid payload field': { ...valid, payload: { id: 'not-a-uuid' } },
    'payload for another event': {
      ...valid,
      payload: { id: randomUUID(), email: 'player@example.com' },
    },
    'missing schema version': missingVersion,
    'unsupported schema version': { ...valid, schemaVersion: 2 },
    'string schema version': { ...valid, schemaVersion: '1' },
    'unknown event type': { ...valid, type: 'profile.unknown' },
  };
  let deliveries = 0;
  for (const [description, value] of Object.entries(invalid)) {
    for (const attempt of [0, 5]) {
      fake.deliver(value, { attempt });
      await nextTurn();
      deliveries++;
      assert.equal(consumed, 0, description);
      assert.equal(handled, 0, description);
      assert.equal(fake.acknowledgments, deliveries, description);
      assert.equal(fake.publications.length, deliveries, description);
      const published = fake.publications.at(-1);
      assert.ok(published, description);
      assert.equal(published.exchange, '', description);
      assert.equal(
        published.routingKey,
        attempt === 0 ? 'jackpot.auth.retry.0' : 'jackpot.auth.failed',
        description,
      );
      assert.equal(
        published.body.toString(),
        JSON.stringify(value),
        description,
      );
      assert.equal(published.properties.persistent, true, description);
      assert.equal(published.properties.mandatory, true, description);
      assert.deepEqual(
        published.properties.headers,
        { attempt: attempt + 1, failure: 'INVALID_ARGUMENT' },
        description,
      );
    }
  }
});

test('invalid delivery is acknowledged only after its retry is confirmed', async (t) => {
  let confirm: ((error: Error | null) => void) | undefined;
  const fake = broker({
    publish: (_channel, _properties, done) => {
      confirm = done;
    },
  });
  t.mock.method(amqp, 'connect', async () => fake.connection);
  const bus = new EventBus('auth', 'amqp://test', database(), async () => {});
  t.after(() => bus.stop());
  await bus.start();
  fake.deliver({ ...event(), schemaVersion: 2 });
  await nextTurn();
  assert.equal(fake.publications.length, 1);
  assert.equal(fake.acknowledgments, 0);
  assert.ok(confirm);
  confirm(null);
  await nextTurn();
  assert.equal(fake.acknowledgments, 1);
});

test('consumer admits the subscribed v1 event and rejects a valid event for another service', async (t) => {
  const fake = broker();
  const consumed: DomainEvent[] = [];
  const handle = async () => {};
  t.mock.method(amqp, 'connect', async () => fake.connection);
  const bus = new EventBus(
    'auth',
    'amqp://test',
    database(async (received, handler) => {
      consumed.push(received);
      assert.equal(handler, handle);
    }),
    handle,
  );
  t.after(() => bus.stop());
  await bus.start();
  const valid = event();
  fake.deliver(valid);
  await nextTurn();
  assert.deepEqual(consumed, [valid]);
  assert.equal(fake.acknowledgments, 1);
  assert.equal(fake.publications.length, 0);

  fake.deliver({
    ...valid,
    id: randomUUID(),
    type: 'identity.registered',
    payload: { id: randomUUID(), email: 'player@example.com' },
  });
  await nextTurn();
  assert.deepEqual(consumed, [valid]);
  assert.equal(fake.acknowledgments, 2);
  assert.equal(fake.publications.length, 1);
  assert.equal(fake.publications[0]?.routingKey, 'jackpot.auth.retry.0');
  assert.equal(
    fake.publications[0]?.properties.headers?.failure,
    'INVALID_ARGUMENT',
  );
});

test('the subscription map covers every event and declares each durable route', async (t) => {
  const fake = broker();
  t.mock.method(amqp, 'connect', async () => fake.connection);
  const bus = new EventBus('auth', 'amqp://test', database(), async () => {});
  t.after(() => bus.stop());
  await bus.start();
  assert.equal(eventTypes.length, 8);
  assert.deepEqual(
    Object.values(subscriptions).flat().sort(),
    [...eventTypes].sort(),
  );
  assert.deepEqual(
    fake.bindings,
    Object.entries(subscriptions).flatMap(([service, types]) =>
      types.map((type) => ({
        queue: `jackpot.${service}`,
        exchange: 'jackpot.events',
        type,
      })),
    ),
  );
});

test(
  'shutdown waits for an in-progress connection and never installs a late consumer',
  { timeout: 3000 },
  async (t) => {
    const connecting = deferred<ChannelModel>();
    const fake = broker();
    t.mock.method(amqp, 'connect', () => connecting.promise);
    const bus = new EventBus('auth', 'amqp://test', database(), async () => {});
    const starting = bus.start();
    let stopped = false;
    const stopping = bus.stop().then(() => {
      stopped = true;
    });
    await nextTurn();
    assert.equal(stopped, false);
    connecting.resolve(fake.connection);
    await Promise.all([starting, stopping]);
    assert.equal(fake.consumers, 0);
    assert.equal(fake.closes, 1);
    assert.equal(await bus.ready(), false);
  },
);

test(
  'shutdown interrupts a connection waiting for broker topology replies',
  { timeout: 3000 },
  async (t) => {
    const fake = broker();
    const openingChannel = deferred<void>();
    fake.connection.createConfirmChannel = async () => {
      openingChannel.resolve();
      return new Promise((_resolve, reject) => {
        fake.connection.once('close', () =>
          reject(new Error('Connection closed during channel negotiation')),
        );
      });
    };
    t.mock.method(amqp, 'connect', async () => fake.connection);
    const bus = new EventBus('auth', 'amqp://test', database(), async () => {});
    const starting = bus.start();
    await openingChannel.promise;
    await bus.stop();
    await starting;
    assert.equal(fake.closes, 1);
    assert.equal(fake.consumers, 0);
  },
);

test(
  'failed retry publication releases all unacknowledged deliveries and reconnects',
  { timeout: 3000 },
  async (t) => {
    const reconnected = deferred<void>();
    const first = broker({
      publish: (_channel, _properties, done) =>
        done(new Error('Broker rejected publication')),
    });
    const second = broker({ onConsume: () => reconnected.resolve() });
    let calls = 0,
      failDatabase = true;
    t.mock.method(amqp, 'connect', async () =>
      ++calls === 1 ? first.connection : second.connection,
    );
    const bus = new EventBus(
      'auth',
      'amqp://test',
      database(async () => {
        if (failDatabase) throw new Error('Transient database outage');
      }),
      async () => {},
    );
    t.after(() => bus.stop());
    await bus.start();
    for (let i = 0; i < 8; i++) first.deliver(event());
    await nextTurn();
    assert.equal(
      first.acknowledgments,
      0,
      'Original deliveries must remain eligible for redelivery',
    );
    assert.equal(
      first.closes,
      1,
      'Closing the failed connection releases its entire prefetch window',
    );
    failDatabase = false;
    await reconnected.promise;
    second.deliver(event());
    await nextTurn();
    assert.equal(second.acknowledgments, 1);
    await bus.stop();
    assert.equal(second.closes, 1);
  },
);

test(
  'confirm timeout closes the connection instead of retaining broker capacity',
  { timeout: 3000 },
  async (t) => {
    const fake = broker({ publish: () => {} });
    t.mock.method(amqp, 'connect', async () => fake.connection);
    const bus = new EventBus('auth', 'amqp://test', database(), async () => {});
    await bus.start();
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const publishing = bus.publish(event());
    const rejected = assert.rejects(
      publishing,
      /Publish confirmation timed out/,
    );
    t.mock.timers.tick(5000);
    await rejected;
    assert.equal(fake.closes, 1);
    t.mock.timers.reset();
    await bus.stop();
  },
);

test(
  'unroutable broker confirmations cannot mark a publication successful',
  { timeout: 3000 },
  async (t) => {
    const fake = broker({
      publish: (channel, properties, done) => {
        assert.equal(properties.mandatory, true);
        channel.emit('return', {
          properties: { messageId: properties.messageId },
        });
        done(null);
      },
    });
    t.mock.method(amqp, 'connect', async () => fake.connection);
    const bus = new EventBus('auth', 'amqp://test', database(), async () => {});
    await bus.start();
    await assert.rejects(bus.publish(event()), /no durable route/);
    assert.equal(fake.closes, 1);
    await bus.stop();
  },
);

test(
  'shutdown bounds a broker close handshake and destroys an unresponsive transport',
  { timeout: 3000 },
  async (t) => {
    const fake = broker({ hangOnClose: true });
    t.mock.method(amqp, 'connect', async () => fake.connection);
    const bus = new EventBus('auth', 'amqp://test', database(), async () => {});
    await bus.start();
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const stopping = bus.stop();
    await nextTurn();
    t.mock.timers.tick(2000);
    await stopping;
    assert.equal(fake.destroyed, 1);
    assert.equal(fake.closes, 1);
    t.mock.timers.reset();
  },
);
