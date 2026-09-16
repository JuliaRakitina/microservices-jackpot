import assert from 'node:assert/strict';
import test from 'node:test';
import {
  eventPayloadSchemas,
  eventSchema,
  eventTypes,
  type EventType,
} from '../../packages/contracts/src/events.js';
import { MAX_POINTS } from '../../packages/contracts/src/points.js';
import {
  eventEnvelopeExample,
  eventPayloadExamples,
} from './events-fixtures.js';

function example(type: EventType) {
  return {
    ...eventEnvelopeExample,
    type,
    payload: eventPayloadExamples[type],
  };
}

test('the discriminated v1 contract covers exactly all eight typed payload schemas', () => {
  assert.equal(eventTypes.length, 8);
  assert.equal(new Set(eventTypes).size, 8);
  assert.deepEqual(
    [...eventTypes].sort(),
    Object.keys(eventPayloadSchemas).sort(),
  );
  assert.deepEqual(
    [...eventTypes].sort(),
    Object.keys(eventPayloadExamples).sort(),
  );
  for (const type of eventTypes) {
    const event = example(type);
    assert.deepEqual(eventSchema.parse(event), event);
  }
});

test('every event requires schemaVersion 1 and a known type', () => {
  for (const type of eventTypes) {
    const event = example(type);
    const { schemaVersion: _schemaVersion, ...unversioned } = event;
    assert.equal(eventSchema.safeParse(unversioned).success, false, type);
    for (const schemaVersion of [0, 2, -1, 1.1, '1', null]) {
      assert.equal(
        eventSchema.safeParse({ ...event, schemaVersion }).success,
        false,
        `${type}: schemaVersion ${String(schemaVersion)}`,
      );
    }
    assert.equal(
      eventSchema.safeParse({ ...event, type: 'unknown.event' }).success,
      false,
    );
  }
});

test('every variant rejects malformed envelopes and unknown envelope or payload fields', () => {
  for (const type of eventTypes) {
    const event = example(type);
    for (const malformed of [
      { ...event, id: 'invalid' },
      { ...event, correlationId: 'invalid' },
      { ...event, occurredAt: 'yesterday' },
      { ...event, traceparent: 'a'.repeat(129) },
      { ...event, version: 1 },
      { ...event, payload: { ...event.payload, unexpected: true } },
      { ...event, payload: {} },
      { ...event, payload: null },
      { ...event, payload: [] },
    ]) {
      assert.equal(eventSchema.safeParse(malformed).success, false, type);
    }
    for (const field of Object.keys(event.payload)) {
      const payload: Record<string, unknown> = { ...event.payload };
      delete payload[field];
      assert.equal(
        eventSchema.safeParse({ ...event, payload }).success,
        false,
        `${type}: missing ${field}`,
      );
    }
  }
});

test('each discriminator rejects a payload belonging to a different event shape', () => {
  for (const type of eventTypes) {
    // Events intentionally sharing one wire shape remain compatible with that shape.
    const payload =
      type === 'profile.created' || type === 'identity.registered'
        ? eventPayloadExamples['bet.settled']
        : eventPayloadExamples['identity.registered'];
    assert.equal(
      eventSchema.safeParse({ ...example(type), payload }).success,
      false,
      type,
    );
  }
});

test('identity, idempotency, reservation and settlement fields reject invalid values', () => {
  const malformed: { type: EventType; fields: Record<string, unknown> }[] = [
    { type: 'identity.registered', fields: { email: 'invalid' } },
    { type: 'identity.registered', fields: { id: 'invalid' } },
    { type: 'profile.created', fields: { id: 'invalid' } },
    { type: 'bet.requested', fields: { key: 'short' } },
    { type: 'bet.requested', fields: { key: 'a'.repeat(129) } },
    { type: 'bet.requested', fields: { betId: 'invalid' } },
    { type: 'funds.reserved', fields: { userId: 'invalid' } },
    { type: 'funds.rejected', fields: { reason: 'unknown_reason' } },
    { type: 'bet.accepted', fields: { betId: 'invalid' } },
    { type: 'bet.settled', fields: { won: 'true' } },
    { type: 'payout.applied', fields: { won: 1 } },
    { type: 'bet.settled', fields: { won: false, payout: '10' } },
    { type: 'payout.applied', fields: { won: false, payout: '10' } },
  ];
  for (const { type, fields } of malformed) {
    const event = example(type);
    assert.equal(
      eventSchema.safeParse({
        ...event,
        payload: { ...event.payload, ...fields },
      }).success,
      false,
      `${type}: ${JSON.stringify(fields)}`,
    );
  }
});

test('event points retain exact int64 decimal strings and reject noncanonical or overflowing amounts', () => {
  for (const type of [
    'bet.requested',
    'funds.reserved',
    'bet.accepted',
    'bet.settled',
    'payout.applied',
  ] as const) {
    const event = example(type);
    const field =
      type === 'bet.settled' || type === 'payout.applied' ? 'payout' : 'amount';
    for (const value of ['1', '9007199254740993', MAX_POINTS.toString()]) {
      const input = {
        ...event,
        payload: { ...event.payload, [field]: value },
      };
      assert.deepEqual(eventSchema.parse(input), input);
    }
    for (const value of [
      1,
      1n,
      '-1',
      '01',
      '1.5',
      '1e2',
      '+1',
      ' 1',
      '',
      (MAX_POINTS + 1n).toString(),
      '9'.repeat(20),
    ]) {
      assert.equal(
        eventSchema.safeParse({
          ...event,
          payload: { ...event.payload, [field]: value },
        }).success,
        false,
        `${type}: ${String(value)}`,
      );
    }
    assert.equal(
      eventSchema.safeParse({
        ...event,
        payload: { ...event.payload, [field]: '0' },
      }).success,
      field === 'payout',
      `${type}: zero points`,
    );
  }
  for (const type of ['bet.settled', 'payout.applied'] as const) {
    const event = example(type);
    const loss = {
      ...event,
      payload: { ...event.payload, won: false, payout: '0' },
    };
    assert.deepEqual(eventSchema.parse(loss), loss);
  }
});
