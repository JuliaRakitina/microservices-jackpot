import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { loadSync, type MessageTypeDefinition } from '@grpc/proto-loader';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  eventSchema,
  eventTypes,
} from '../../packages/contracts/src/events.js';

const definition = loadSync('packages/contracts/proto/jackpot/v1/api.proto', {
  longs: String,
  defaults: true,
});
test('Buf accepts the unchanged v1 contract and rejects a point field type change', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'jackpot-contract-test-'));
  try {
    const original = join(temp, 'original');
    const changed = join(temp, 'changed');
    for (const target of [original, changed]) {
      await cp(
        'packages/contracts/proto',
        join(target, 'packages/contracts/proto'),
        { recursive: true },
      );
      await cp('buf.yaml', join(target, 'buf.yaml'));
    }
    execFileSync('buf', ['breaking', changed, '--against', original], {
      stdio: 'pipe',
    });
    const path = join(changed, 'packages/contracts/proto/jackpot/v1/api.proto');
    const source = await readFile(path, 'utf8');
    const incompatible = source.replace(
      'string amount = 2;',
      'int32 amount = 2;',
    );
    assert.notEqual(source, incompatible);
    await writeFile(path, incompatible);
    assert.throws(() =>
      execFileSync('buf', ['breaking', changed, '--against', original], {
        stdio: 'pipe',
      }),
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
test('canonical protobuf transports all points as exact decimal strings', () => {
  for (const [message, field] of [
    ['SubmitRequest', 'amount'],
    ['GetUserResponse', 'balance'],
    ['GetPoolResponse', 'balance'],
    ['GetBetResponse', 'payout'],
    ['LedgerEntry', 'delta'],
  ]) {
    const descriptor = definition[
      `jackpot.v1.${message}`
    ] as MessageTypeDefinition<Record<string, string>, Record<string, string>>;
    const input = { [field!]: '9007199254740993' };
    const output = descriptor.deserialize(descriptor.serialize(input));
    assert.equal(output[field!], input[field!]);
  }
});
test('all versioned domain envelopes validate correlation and reject unexpected schema fields', () => {
  for (const type of eventTypes) {
    const event = {
      id: randomUUID(),
      type,
      correlationId: randomUUID(),
      occurredAt: new Date().toISOString(),
      payload: {},
    };
    assert.equal(eventSchema.parse(event).type, type);
    assert.equal(
      eventSchema.safeParse({ ...event, correlationId: 'untrusted' }).success,
      false,
    );
    assert.equal(
      eventSchema.safeParse({ ...event, version: 99 }).success,
      false,
    );
  }
});
