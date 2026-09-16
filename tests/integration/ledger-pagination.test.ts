import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { loadSync, type MessageTypeDefinition } from '@grpc/proto-loader';
import { DomainError } from '../../packages/contracts/src/errors.js';
import { createClients, serveRpc } from '../../packages/contracts/src/rpc.js';
import { createFixture, event } from '../../packages/testing/src/fixture.js';

test(
  'ledger pagination keeps exact sequence cursors and bounded gRPC responses',
  { timeout: 240_000 },
  async (t) => {
    const fixture = await createFixture({ startBuses: false });
    t.after(() => fixture.close());
    const { users } = fixture.services;
    const userId = randomUUID();
    const otherId = randomUUID();
    for (const id of [userId, otherId]) {
      await fixture.dbs.users.consume(
        event('identity.registered', { id, email: `${id}@example.test` }),
        (message, tx) => users.handle(message, tx),
      );
    }
    assert.deepEqual(await users.getLedger({ id: userId }), {
      entries: [],
      nextCursor: '',
    });

    // Sequence values beyond Number.MAX_SAFE_INTEGER must remain exact strings.
    await fixture.dbs.users.query(
      'ALTER SEQUENCE ledger_sequence_seq RESTART WITH 9007199254740993',
    );
    const firstAmount = 9007199254740993n;
    for (let index = 0; index < 105; index++) {
      await users.credit({
        id: userId,
        amount: index === 0 ? firstAmount.toString() : '1',
        key: randomUUID(),
      });
      if (index % 35 === 0) {
        await users.credit({ id: otherId, amount: '7', key: randomUUID() });
      }
    }
    const server = await serveRpc('users', users, fixture.jwtSecret, 0);
    const address = `127.0.0.1:${server.port}`;
    const rpc = createClients(
      { auth: address, users: address, bets: address, jackpot: address },
      fixture.jwtSecret,
    );
    t.after(async () => {
      rpc.close();
      await new Promise<void>((resolve) => server.tryShutdown(() => resolve()));
    });
    const first = await rpc.clients.users.getLedger({ id: userId });
    assert.equal(first.entries.length, 100);
    assert.ok(BigInt(first.nextCursor) > BigInt(Number.MAX_SAFE_INTEGER));
    assert.equal(first.entries[0]?.delta, firstAmount.toString());
    assert.equal(first.entries.at(-1)?.balance, (firstAmount + 99n).toString());
    assert.deepEqual(await users.getLedger({ id: userId, cursor: '0' }), first);

    // Later committed rows can join the next page without shifting earlier rows.
    await users.credit({ id: userId, amount: '1', key: randomUUID() });
    const second = await rpc.clients.users.getLedger({
      id: userId,
      cursor: first.nextCursor,
    });
    assert.equal(second.entries.length, 6);
    assert.equal(second.nextCursor, '');
    assert.equal(
      second.entries.at(-1)?.balance,
      (firstAmount + 105n).toString(),
    );
    const combined = [...first.entries, ...second.entries];
    assert.equal(new Set(combined.map((entry) => entry.id)).size, 106);
    const stored = await fixture.dbs.users.query<{ id: string }>(
      'SELECT id FROM ledger WHERE user_id = $1 ORDER BY sequence',
      [userId],
    );
    assert.deepEqual(
      combined.map((entry) => entry.id),
      stored.map((entry) => entry.id),
    );
    assert.equal((await users.getLedger({ id: otherId })).entries.length, 3);
    assert.deepEqual(
      await users.getLedger({ id: userId, cursor: '9223372036854775807' }),
      { entries: [], nextCursor: '' },
    );

    const definition = loadSync(
      'packages/contracts/proto/jackpot/v1/api.proto',
      { keepCase: false, longs: String, defaults: true },
    );
    const descriptor = definition[
      'jackpot.v1.GetLedgerResponse'
    ] as MessageTypeDefinition<typeof first, typeof first>;
    assert.ok(
      descriptor.serialize(first).length < 65_536,
      'A full ledger page must fit the configured gRPC response bound',
    );
    for (const cursor of [
      '',
      '-1',
      '01',
      '1.5',
      '1e3',
      '9223372036854775808',
      1,
      ['1'],
    ]) {
      await assert.rejects(
        users.getLedger({ id: userId, cursor }),
        (error: unknown) =>
          error instanceof DomainError && error.code === 'INVALID_ARGUMENT',
      );
    }
    await assert.rejects(
      users.getLedger({ id: userId, limit: 200 }),
      (error: unknown) =>
        error instanceof DomainError && error.code === 'INVALID_ARGUMENT',
    );
    await assert.rejects(
      users.getLedger({ id: randomUUID() }),
      (error: unknown) =>
        error instanceof DomainError && error.code === 'NOT_FOUND',
    );
  },
);
