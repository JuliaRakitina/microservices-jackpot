import assert from 'node:assert/strict';
import test from 'node:test';
import type { EntityManager } from 'typeorm';
import {
  eventSchema,
  eventTypes,
} from '../../packages/contracts/src/events.js';
import { Transaction } from '../../packages/runtime/src/database.js';
import {
  eventEnvelopeExample,
  eventPayloadExamples,
} from './events-fixtures.js';

function producer() {
  const writes: { sql: string; parameters: unknown[] }[] = [];
  const manager = {
    query: async (sql: string, parameters: unknown[]) => {
      writes.push({ sql, parameters });
      return [];
    },
  } as unknown as EntityManager;
  const tx = new Transaction(manager);
  // Exercise callers outside TypeScript as well as the compile-time contract.
  const emitUntrusted = (
    type: unknown,
    payload: unknown,
    correlationId: unknown,
  ) =>
    Reflect.apply(tx.emit, tx, [type, payload, correlationId]) as Promise<void>;
  return { writes, emitUntrusted };
}

test('every producer writes a complete validated v1 event to the outbox', async () => {
  const { writes, emitUntrusted } = producer();
  for (const type of eventTypes) {
    await emitUntrusted(
      type,
      eventPayloadExamples[type],
      eventEnvelopeExample.correlationId,
    );
    const write = writes.at(-1)!;
    assert.equal(write.sql, 'INSERT INTO outbox(id,event) VALUES ($1,$2)');
    const stored = eventSchema.parse(JSON.parse(String(write.parameters[1])));
    assert.equal(stored.id, write.parameters[0]);
    assert.equal(stored.schemaVersion, 1);
    assert.equal(stored.type, type);
    assert.equal(stored.correlationId, eventEnvelopeExample.correlationId);
    assert.deepEqual(stored.payload, eventPayloadExamples[type]);
  }
  assert.equal(writes.length, 8);
});

test('all producers reject malformed or excess payload fields before any outbox write', async () => {
  const { writes, emitUntrusted } = producer();
  for (const type of eventTypes) {
    for (const payload of [
      {},
      null,
      { ...eventPayloadExamples[type], unexpected: true },
    ]) {
      await assert.rejects(
        emitUntrusted(type, payload, eventEnvelopeExample.correlationId),
        { code: 'INVALID_ARGUMENT' },
        type,
      );
    }
  }
  assert.deepEqual(writes, []);
});

test('producer rejects invalid envelope metadata and unknown types before insertion', async () => {
  const { writes, emitUntrusted } = producer();
  await assert.rejects(
    emitUntrusted(
      'profile.created',
      eventPayloadExamples['profile.created'],
      'invalid-correlation',
    ),
    { code: 'INVALID_ARGUMENT' },
  );
  await assert.rejects(
    emitUntrusted(
      'unknown.event',
      eventPayloadExamples['profile.created'],
      eventEnvelopeExample.correlationId,
    ),
    { code: 'INVALID_ARGUMENT' },
  );
  // Valid for profile.created, but not identity.registered: its email is required.
  await assert.rejects(
    emitUntrusted(
      'identity.registered',
      eventPayloadExamples['profile.created'],
      eventEnvelopeExample.correlationId,
    ),
    { code: 'INVALID_ARGUMENT' },
  );
  await assert.rejects(
    emitUntrusted(
      'bet.accepted',
      { ...eventPayloadExamples['bet.accepted'], amount: '0' },
      eventEnvelopeExample.correlationId,
    ),
    { code: 'INVALID_ARGUMENT' },
  );
  assert.deepEqual(writes, []);
});
