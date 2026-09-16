import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { DomainError } from '../../packages/contracts/src/errors.js';
import type { DomainEvent } from '../../packages/contracts/src/events.js';
import {
  createFixture,
  docker,
  eventually,
  event,
  migrations,
  type Fixture,
} from '../../packages/testing/src/fixture.js';

async function newUser(fixture: Fixture, balance = '0') {
  const email = `${randomUUID()}@example.test`;
  const password = `${randomUUID()}-local-test`;
  const identity = await fixture.services.auth.register(
    { email, password },
    randomUUID(),
  );
  await eventually(
    async () =>
      (await fixture.services.users.getUser({ id: identity.id })).role ===
      'user',
  );
  if (balance !== '0')
    await fixture.services.users.credit(
      { id: identity.id, amount: balance, key: randomUUID() },
      randomUUID(),
    );
  return { id: identity.id, email, password };
}

async function finalBet(fixture: Fixture, id: string, userId: string) {
  await eventually(async () =>
    ['won', 'lost', 'rejected'].includes(
      (await fixture.services.bets.getBet({ id, userId })).state,
    ),
  );
  return fixture.services.bets.getBet({ id, userId });
}

async function storedEvent(
  fixture: Fixture,
  service: 'users' | 'bets' | 'jackpot',
  type: string,
  betId: string,
) {
  const [row] = await fixture.dbs[service].query<{ event: DomainEvent }>(
    "SELECT event FROM outbox WHERE event->>'type' = $1 AND event->'payload'->>'betId' = $2",
    [type, betId],
  );
  assert.ok(row, `Expected persisted ${type} event`);
  return row.event;
}

test(
  'PostgreSQL and RabbitMQ prove the complete points workflow',
  { timeout: 600_000 },
  async (t) => {
    let draw = 1;
    const fixture = await createFixture({
      selector: () => ({ won: draw === 0, draw }),
    });
    t.after(() => fixture.close());

    await t.test(
      'all service migrations initialize empty databases and rerun without mutation',
      async () => {
        for (const name of ['auth', 'users', 'bets', 'jackpot'] as const) {
          await fixture.dbs[name].migrate(migrations[name]);
          const [row] = await fixture.dbs[name].query<{ count: string }>(
            'SELECT count(*)::text AS count FROM schema_migrations',
          );
          assert.equal(row?.count, '1');
        }
        assert.deepEqual(await fixture.services.jackpot.getPool({}), {
          balance: '0',
          round: '1',
        });
        await assert.rejects(fixture.dbs.bets.query('SELECT * FROM profiles'));
        const emptyMetrics =
          await fixture.services.bets.metrics.getMetricsAsJSON();
        const emptyOutcomes = emptyMetrics.find(
          (metric) => metric.name === 'bet_outcomes',
        );
        assert.ok(emptyOutcomes);
        assert.equal(emptyOutcomes.values.length, 5);
        assert.ok(emptyOutcomes.values.every((value) => value.value === 0));
        const emptyLatency = emptyMetrics.find(
          (metric) => metric.name === 'bet_settlement_latency_seconds',
        );
        assert.ok(emptyLatency);
        assert.deepEqual(
          emptyLatency.values.map((value) => value.value),
          [0, 0],
        );
      },
    );

    await t.test(
      'pending registration recovers when the Users consumer restarts and always assigns user',
      async () => {
        const orphan = event('profile.created', { id: randomUUID() });
        await assert.rejects(
          fixture.dbs.auth.consume(orphan, (message, tx) =>
            fixture.services.auth.handle(message, tx),
          ),
          (error: unknown) =>
            error instanceof DomainError &&
            error.code === 'FAILED_PRECONDITION',
        );
        assert.equal(
          (
            await fixture.dbs.auth.query('SELECT id FROM inbox WHERE id = $1', [
              orphan.id,
            ])
          ).length,
          0,
        );
        await fixture.buses.users.stop();
        const input = {
          email: `${randomUUID()}@example.test`,
          password: randomUUID(),
        };
        const identity = await fixture.services.auth.register(
          input,
          randomUUID(),
        );
        assert.equal(identity.state, 'pending');
        await assert.rejects(
          fixture.services.auth.login(input),
          (error: unknown) =>
            error instanceof DomainError &&
            error.code === 'FAILED_PRECONDITION',
        );
        await fixture.buses.users.start();
        await eventually(
          async () =>
            (await fixture.services.auth.login(input)).expiresIn === 900,
        );
        assert.equal(
          (await fixture.services.users.getUser({ id: identity.id })).role,
          'user',
        );
        await assert.rejects(
          fixture.services.auth.register(
            { ...input, email: `${randomUUID()}@example.test`, role: 'admin' },
            randomUUID(),
          ),
        );
      },
    );

    await t.test(
      'concurrent reuse of one caller key produces one debit and rejects mismatching payloads',
      async () => {
        const user = await newUser(fixture, '100');
        const key = randomUUID();
        const commands = await Promise.all(
          Array.from({ length: 12 }, () =>
            fixture.services.bets.submit(
              { userId: user.id, amount: '10', key },
              randomUUID(),
            ),
          ),
        );
        assert.equal(new Set(commands.map((bet) => bet.id)).size, 1);
        const bet = commands[0]!;
        assert.equal((await finalBet(fixture, bet.id, user.id)).state, 'lost');
        assert.equal(
          (await fixture.services.users.getUser({ id: user.id })).balance,
          '90',
        );
        const ledger = await fixture.services.users.getLedger({ id: user.id });
        assert.equal(
          ledger.entries.filter((entry) => entry.reference.startsWith('debit:'))
            .length,
          1,
        );
        await assert.rejects(
          fixture.services.bets.submit(
            { userId: user.id, amount: '11', key },
            randomUUID(),
          ),
          (error: unknown) =>
            error instanceof DomainError && error.code === 'ALREADY_EXISTS',
        );
        await assert.rejects(
          fixture.services.bets.getBet({ id: bet.id, userId: randomUUID() }),
          (error: unknown) =>
            error instanceof DomainError && error.code === 'NOT_FOUND',
        );
      },
    );

    await t.test(
      'twenty concurrent requests cannot overspend and rejected bets do not mutate the pool',
      async () => {
        const user = await newUser(fixture, '50');
        const before = BigInt(
          (await fixture.services.jackpot.getPool({})).balance,
        );
        const bets = await Promise.all(
          Array.from({ length: 20 }, () =>
            fixture.services.bets.submit(
              { userId: user.id, amount: '10', key: randomUUID() },
              randomUUID(),
            ),
          ),
        );
        const settled = await Promise.all(
          bets.map((bet) => finalBet(fixture, bet.id, user.id)),
        );
        assert.equal(settled.filter((bet) => bet.state === 'lost').length, 5);
        assert.equal(
          settled.filter((bet) => bet.state === 'rejected').length,
          15,
        );
        assert.equal(
          (await fixture.services.users.getUser({ id: user.id })).balance,
          '0',
        );
        assert.equal(
          BigInt((await fixture.services.jackpot.getPool({})).balance),
          before + 5n,
        );
        const ledger = await fixture.services.users.getLedger({ id: user.id });
        assert.equal(
          ledger.entries.filter((entry) => entry.delta === '-10').length,
          5,
        );
        assert.equal(
          ledger.entries.some((entry) => entry.reference.startsWith('payout:')),
          false,
        );
      },
    );

    await t.test(
      'parallel accepted bets preserve every pool contribution and ledger running balance',
      async () => {
        const users = await Promise.all(
          Array.from({ length: 4 }, () => newUser(fixture, '500')),
        );
        const before = BigInt(
          (await fixture.services.jackpot.getPool({})).balance,
        );
        const bets = await Promise.all(
          Array.from({ length: 20 }, (_, index) =>
            fixture.services.bets.submit(
              {
                userId: users[index % users.length]!.id,
                amount: '19',
                key: randomUUID(),
              },
              randomUUID(),
            ),
          ),
        );
        for (const bet of bets)
          assert.equal(
            (await finalBet(fixture, bet.id, bet.userId)).state,
            'lost',
          );
        assert.equal(
          BigInt((await fixture.services.jackpot.getPool({})).balance),
          before + 20n,
        );
        for (const user of users) {
          const ledger = await fixture.services.users.getLedger({
            id: user.id,
          });
          let running = 0n;
          for (const entry of ledger.entries) {
            running += BigInt(entry.delta);
            assert.equal(BigInt(entry.balance), running);
          }
          assert.equal(
            (await fixture.services.users.getUser({ id: user.id })).balance,
            running.toString(),
          );
        }
      },
    );

    await t.test(
      'redelivery under identical and new event IDs cannot debit or contribute twice',
      async () => {
        const user = await newUser(fixture, '100');
        const bet = await fixture.services.bets.submit(
          { userId: user.id, amount: '10', key: randomUUID() },
          randomUUID(),
        );
        await finalBet(fixture, bet.id, user.id);
        const before = await fixture.services.jackpot.getPool({});
        const requested = await storedEvent(
          fixture,
          'bets',
          'bet.requested',
          bet.id,
        );
        const accepted = await storedEvent(
          fixture,
          'bets',
          'bet.accepted',
          bet.id,
        );
        const requestedAgain = { ...requested, id: randomUUID() };
        const acceptedAgain = { ...accepted, id: randomUUID() };
        for (const message of [
          requested,
          requestedAgain,
          accepted,
          acceptedAgain,
        ])
          await fixture.buses.bets.publish(message);
        await eventually(
          async () =>
            (
              await fixture.dbs.users.query(
                'SELECT id FROM inbox WHERE id = $1',
                [requestedAgain.id],
              )
            ).length === 1 &&
            (
              await fixture.dbs.jackpot.query(
                'SELECT id FROM inbox WHERE id = $1',
                [acceptedAgain.id],
              )
            ).length === 1,
        );
        assert.equal(
          (await fixture.services.users.getUser({ id: user.id })).balance,
          '90',
        );
        assert.deepEqual(await fixture.services.jackpot.getPool({}), before);
        const mismatch = {
          ...requested,
          id: randomUUID(),
          payload: { ...requested.payload, amount: '11' },
        };
        await assert.rejects(
          fixture.dbs.users.consume(mismatch, (message, tx) =>
            fixture.services.users.handle(message, tx),
          ),
          (error: unknown) =>
            error instanceof DomainError && error.code === 'ALREADY_EXISTS',
        );
        const sameIdMismatch = {
          ...requested,
          payload: { ...requested.payload, amount: '12' },
        };
        await assert.rejects(
          fixture.dbs.users.consume(sameIdMismatch, (message, tx) =>
            fixture.services.users.handle(message, tx),
          ),
        );
      },
    );

    await t.test(
      'winning settlement and redelivery credit exactly once and close the round atomically',
      async () => {
        const user = await newUser(fixture, '100');
        const before = await fixture.services.jackpot.getPool({});
        draw = 0;
        const bet = await fixture.services.bets.submit(
          { userId: user.id, amount: '20', key: randomUUID() },
          randomUUID(),
        );
        const settled = await finalBet(fixture, bet.id, user.id);
        draw = 1;
        const payout = BigInt(before.balance) + 2n;
        assert.equal(settled.state, 'won');
        assert.equal(settled.payout, payout.toString());
        assert.deepEqual(await fixture.services.jackpot.getPool({}), {
          balance: '0',
          round: (BigInt(before.round) + 1n).toString(),
        });
        const original = await storedEvent(
          fixture,
          'jackpot',
          'bet.settled',
          bet.id,
        );
        const repeated = { ...original, id: randomUUID() };
        await fixture.buses.jackpot.publish(original);
        await fixture.buses.jackpot.publish(repeated);
        await eventually(
          async () =>
            (
              await fixture.dbs.users.query(
                'SELECT id FROM inbox WHERE id = $1',
                [repeated.id],
              )
            ).length === 1,
        );
        assert.equal(
          (await fixture.services.users.getUser({ id: user.id })).balance,
          (80n + payout).toString(),
        );
        const entries = (
          await fixture.services.users.getLedger({ id: user.id })
        ).entries;
        assert.equal(
          entries.filter((entry) => entry.reference === `payout:${bet.id}`)
            .length,
          1,
        );
        await assert.rejects(
          fixture.dbs.users.consume(
            {
              ...original,
              id: randomUUID(),
              payload: {
                ...original.payload,
                payout: (payout + 1n).toString(),
              },
            },
            (message, tx) => fixture.services.users.handle(message, tx),
          ),
        );
      },
    );

    await t.test(
      'persisted outcome and settlement latency metrics survive duplicate confirmations',
      async () => {
        const before = await fixture.services.bets.metrics.getMetricsAsJSON();
        const outcomes = before.find(
          (metric) => metric.name === 'bet_outcomes',
        );
        assert.ok(outcomes);
        const stored = await fixture.dbs.bets.query<{
          state: string;
          count: string;
        }>('SELECT state, count(*)::text AS count FROM bets GROUP BY state');
        const counts = new Map(
          stored.map((row) => [row.state, Number(row.count)]),
        );
        for (const value of outcomes.values) {
          assert.equal(
            value.value,
            counts.get(String(value.labels.state)) ?? 0,
          );
        }
        const latency = before.find(
          (metric) => metric.name === 'bet_settlement_latency_seconds',
        );
        assert.ok(latency);
        const [duration] = await fixture.dbs.bets.query<{
          mean: string;
          max: string;
        }>(
          `SELECT avg(EXTRACT(EPOCH FROM (updated_at - created_at)))::text AS mean,
                max(EXTRACT(EPOCH FROM (updated_at - created_at)))::text AS max
         FROM bets WHERE state IN ('won', 'lost')`,
        );
        assert.ok(duration);
        assert.equal(
          latency.values.find((value) => value.labels.statistic === 'mean')
            ?.value,
          Number(duration.mean),
        );
        assert.equal(
          latency.values.find((value) => value.labels.statistic === 'max')
            ?.value,
          Number(duration.max),
        );
        const [won] = await fixture.dbs.bets.query<{
          id: string;
          user_id: string;
          payout: string;
        }>("SELECT id, user_id, payout FROM bets WHERE state = 'won' LIMIT 1");
        assert.ok(won);
        const duplicate = event('payout.applied', {
          betId: won.id,
          userId: won.user_id,
          won: true,
          payout: won.payout,
        });
        await fixture.buses.users.publish(duplicate);
        await eventually(
          async () =>
            (
              await fixture.dbs.bets.query(
                'SELECT id FROM inbox WHERE id = $1',
                [duplicate.id],
              )
            ).length === 1,
        );
        assert.deepEqual(
          await fixture.services.bets.metrics.getMetricsAsJSON(),
          before,
        );
        const deliveryMetrics =
          await fixture.buses.bets.registry.getMetricsAsJSON();
        assert.ok(
          deliveryMetrics.some(
            (metric) => metric.name === 'settlement_deliveries_total',
          ),
        );
        assert.equal(
          deliveryMetrics.some(
            (metric) => metric.name === 'bet_outcomes_total',
          ),
          false,
        );
      },
    );

    await t.test(
      'failed consumer transaction rolls back its debit, inbox and outbox before safe retry',
      async () => {
        const user = await newUser(fixture, '100');
        await fixture.buses.users.stop();
        const bet = await fixture.services.bets.submit(
          { userId: user.id, amount: '20', key: randomUUID() },
          randomUUID(),
        );
        const message = await storedEvent(
          fixture,
          'bets',
          'bet.requested',
          bet.id,
        );
        const [before] = await fixture.dbs.users.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM outbox',
        );
        await assert.rejects(
          fixture.dbs.users.consume(message, async (delivery, tx) => {
            await fixture.services.users.handle(delivery, tx);
            throw new Error('Injected failure before transaction commit');
          }),
        );
        assert.equal(
          (await fixture.services.users.getUser({ id: user.id })).balance,
          '100',
        );
        assert.equal(
          (
            await fixture.dbs.users.query(
              'SELECT id FROM inbox WHERE id = $1',
              [message.id],
            )
          ).length,
          0,
        );
        const [after] = await fixture.dbs.users.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM outbox',
        );
        assert.equal(after?.count, before?.count);
        await fixture.buses.users.start();
        assert.equal((await finalBet(fixture, bet.id, user.id)).state, 'lost');
        assert.equal(
          (await fixture.services.users.getUser({ id: user.id })).balance,
          '80',
        );
        assert.equal(
          (
            await fixture.dbs.users.query(
              'SELECT id FROM inbox WHERE id = $1',
              [message.id],
            )
          ).length,
          1,
        );
        await assert.rejects(
          fixture.dbs.users.query(
            'UPDATE ledger SET delta = 1 WHERE user_id = $1',
            [user.id],
          ),
        );
        await assert.rejects(
          fixture.dbs.users.query('DELETE FROM ledger WHERE user_id = $1', [
            user.id,
          ]),
        );
      },
    );

    await t.test(
      'out-of-order payout cannot finalize an unaccepted bet or credit an unrelated account',
      async () => {
        const user = await newUser(fixture, '100');
        await fixture.buses.users.stop();
        const bet = await fixture.services.bets.submit(
          { userId: user.id, amount: '10', key: randomUUID() },
          randomUUID(),
        );
        const early = event('payout.applied', {
          betId: bet.id,
          userId: user.id,
          won: true,
          payout: '10',
        });
        await assert.rejects(
          fixture.dbs.bets.consume(early, (message, tx) =>
            fixture.services.bets.handle(message, tx),
          ),
          (error: unknown) =>
            error instanceof DomainError &&
            error.code === 'FAILED_PRECONDITION',
        );
        assert.equal(
          (await fixture.services.bets.getBet({ id: bet.id, userId: user.id }))
            .state,
          'funds_pending',
        );
        await fixture.buses.users.start();
        await finalBet(fixture, bet.id, user.id);
        const other = await newUser(fixture);
        const settled = await storedEvent(
          fixture,
          'jackpot',
          'bet.settled',
          bet.id,
        );
        await assert.rejects(
          fixture.dbs.users.consume(
            {
              ...settled,
              id: randomUUID(),
              payload: { ...settled.payload, userId: other.id },
            },
            (message, tx) => fixture.services.users.handle(message, tx),
          ),
        );
        assert.equal(
          (await fixture.services.users.getUser({ id: other.id })).balance,
          '0',
        );
      },
    );

    await t.test(
      'a broker restart retains a pending command and services recover their readiness',
      async () => {
        const user = await newUser(fixture, '100');
        await docker(['stop', '--time', '10', fixture.brokerContainer]);
        await eventually(async () => !(await fixture.buses.bets.ready()));
        assert.equal(await fixture.dbs.bets.ready(), true);
        const bet = await fixture.services.bets.submit(
          { userId: user.id, amount: '10', key: randomUUID() },
          randomUUID(),
        );
        assert.equal(bet.state, 'funds_pending');
        const pending = await fixture.dbs.bets.query(
          "SELECT id FROM outbox WHERE published_at IS NULL AND event->'payload'->>'betId' = $1",
          [bet.id],
        );
        assert.equal(pending.length, 1);
        await docker(['start', fixture.brokerContainer]);
        await eventually(
          async () =>
            (
              await Promise.all(
                Object.values(fixture.buses).map((bus) => bus.ready()),
              )
            ).every(Boolean),
          { timeoutMs: 120_000 },
        );
        assert.equal((await finalBet(fixture, bet.id, user.id)).state, 'lost');
        assert.equal(
          (await fixture.services.users.getUser({ id: user.id })).balance,
          '90',
        );
      },
    );
  },
);
