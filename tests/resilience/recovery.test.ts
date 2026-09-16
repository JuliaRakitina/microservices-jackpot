import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import amqp from 'amqplib';
import { EventBus } from '../../packages/runtime/src/bus.js';
import { healthServer } from '../../packages/runtime/src/health.js';
import {
  createFixture,
  docker,
  eventually,
} from '../../packages/testing/src/fixture.js';

test(
  'bounded retries, failure inspection, replay and dependency health',
  { timeout: 180000 },
  async (t) => {
    const fixture = await createFixture({ startBuses: false });
    const cleanup: Array<() => Promise<unknown>> = [() => fixture.close()];
    t.after(async () => {
      for (const close of cleanup.reverse()) await close();
    });
    let fail = true;
    const usersBus = new EventBus(
      'users',
      fixture.brokerUrl,
      fixture.dbs.users,
      async (event, tx) => {
        if (fail && event.type === 'bet.requested')
          throw new Error('Injected transient storage failure');
        await fixture.services.users.handle(event, tx);
      },
    );
    cleanup.push(() => usersBus.stop());
    await Promise.all([
      usersBus.start(),
      fixture.buses.auth.start(),
      fixture.buses.bets.start(),
      fixture.buses.jackpot.start(),
    ]);
    const health = await healthServer(
      0,
      async () => (await fixture.dbs.users.ready()) && (await usersBus.ready()),
      usersBus.registry,
    );
    cleanup.push(() => health.close());
    const healthUrl = await health.getUrl();
    const connection = await amqp.connect(fixture.brokerUrl);
    cleanup.push(() => connection.close());
    const channel = await connection.createChannel();
    const email = `recovery-${randomUUID()}@example.test`;
    const password = randomBytes(24).toString('hex');
    const registered = await fixture.services.auth.register(
      { email, password },
      randomUUID(),
    );
    await eventually(async () => {
      await fixture.services.auth.login({ email, password });
      return true;
    });
    await fixture.services.users.credit({
      id: registered.id,
      amount: '100',
      key: randomUUID(),
    });
    const bet = await fixture.services.bets.submit(
      { userId: registered.id, amount: '10', key: randomUUID() },
      randomUUID(),
    );
    await t.test(
      'poison delivery is retained in failed queue after bounded retries with no debit',
      async () => {
        await eventually(
          async () =>
            (await channel.checkQueue('jackpot.users.failed')).messageCount ===
            1,
          { timeoutMs: 45000 },
        );
        assert.equal(
          (await fixture.services.users.getUser({ id: registered.id })).balance,
          '100',
        );
        assert.equal(
          (
            await fixture.services.bets.getBet({
              id: bet.id,
              userId: registered.id,
            })
          ).state,
          'funds_pending',
        );
        assert.match(
          await usersBus.registry.metrics(),
          /consumer_failures_total\{type="bet.requested"\} 6/,
        );
      },
    );
    await t.test(
      'operator replay after repair completes the original command exactly once',
      async () => {
        fail = false;
        const output = await new Promise<string>((resolve, reject) =>
          execFile(
            process.execPath,
            ['dist/scripts/replay-failures.js', 'users'],
            {
              env: { ...process.env, BROKER_URL: fixture.brokerUrl },
              timeout: 15000,
            },
            (error, stdout) =>
              error
                ? reject(new Error('Replay command failed'))
                : resolve(stdout),
          ),
        );
        assert.equal((JSON.parse(output) as { replayed: number }).replayed, 1);
        await eventually(
          async () =>
            (
              await fixture.services.bets.getBet({
                id: bet.id,
                userId: registered.id,
              })
            ).state === 'lost',
        );
        assert.equal(
          (await fixture.services.users.getUser({ id: registered.id })).balance,
          '90',
        );
        const ledger = await fixture.services.users.getLedger({
          id: registered.id,
        });
        assert.equal(
          ledger.entries.filter(
            (entry) => entry.reference === `debit:${bet.id}`,
          ).length,
          1,
        );
        assert.equal(
          (await channel.checkQueue('jackpot.users.failed')).messageCount,
          0,
        );
      },
    );
    await t.test(
      'consumer restart resumes accepted work from durable queues',
      async () => {
        await fixture.buses.jackpot.stop();
        const pending = await fixture.services.bets.submit(
          { userId: registered.id, amount: '10', key: randomUUID() },
          randomUUID(),
        );
        await eventually(
          async () =>
            (
              await fixture.services.bets.getBet({
                id: pending.id,
                userId: registered.id,
              })
            ).state === 'accepted',
        );
        await fixture.buses.jackpot.start();
        await eventually(
          async () =>
            (
              await fixture.services.bets.getBet({
                id: pending.id,
                userId: registered.id,
              })
            ).state === 'lost',
        );
        assert.equal(
          (await fixture.services.users.getUser({ id: registered.id })).balance,
          '80',
        );
      },
    );
    await t.test(
      'database outage makes readiness fail while liveness remains healthy',
      async () => {
        assert.equal((await fetch(`${healthUrl}/ready`)).status, 200);
        await docker(['stop', '--time', '2', fixture.postgresContainer]);
        try {
          assert.equal((await fetch(`${healthUrl}/live`)).status, 200);
          assert.equal((await fetch(`${healthUrl}/ready`)).status, 503);
        } finally {
          await docker(['start', fixture.postgresContainer]);
        }
        await eventually(
          async () => (await fetch(`${healthUrl}/ready`)).status === 200,
          { timeoutMs: 30000 },
        );
      },
    );
  },
);
