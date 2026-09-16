import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { createGateway } from '../../apps/gateway/src/app.js';
import { createClients, serveRpc } from '../../packages/contracts/src/rpc.js';
import {
  createFixture,
  eventually,
} from '../../packages/testing/src/fixture.js';

test(
  'HTTP → gRPC → PostgreSQL/RabbitMQ end-to-end',
  { timeout: 180000 },
  async (t) => {
    const fixture = await createFixture();
    t.after(() => fixture.close());
    const internalToken = randomBytes(32).toString('hex');
    const names = ['auth', 'users', 'bets', 'jackpot'] as const;
    const servers = await Promise.all(
      names.map((name) =>
        serveRpc(name, fixture.services[name], internalToken, 0),
      ),
    );
    t.after(() =>
      Promise.all(
        servers.map(
          (server) =>
            new Promise<void>((resolve) => server.tryShutdown(() => resolve())),
        ),
      ),
    );
    const addresses = Object.fromEntries(
      names.map((name, i) => [name, `127.0.0.1:${servers[i]!.port}`]),
    ) as Record<(typeof names)[number], string>;
    const rpc = createClients(addresses, internalToken);
    t.after(() => rpc.close());
    const app = await createGateway(rpc.clients, async () =>
      (
        await Promise.all(Object.values(fixture.dbs).map((db) => db.ready()))
      ).every(Boolean),
    );
    await app.listen(0, '127.0.0.1');
    t.after(() => app.close());
    const url = await app.getUrl();
    async function request(
      path: string,
      body?: unknown,
      token?: string,
      key?: string,
      correlationId?: string,
    ) {
      const headers: Record<string, string> = {};
      if (body !== undefined) headers['content-type'] = 'application/json';
      if (token) headers.authorization = `Bearer ${token}`;
      if (key) headers['idempotency-key'] = key;
      if (correlationId) headers['x-correlation-id'] = correlationId;
      const response = await fetch(`${url}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return {
        response,
        data: (await response.json()) as Record<string, unknown>,
      };
    }
    const email = `user-${randomUUID()}@example.test`;
    const password = randomBytes(24).toString('hex');
    let id = '';
    let accessToken = '';
    await t.test(
      'registration enforces ordinary role and completes durable provisioning',
      async () => {
        assert.equal(
          (
            await request('/v1/auth/register', {
              email,
              password,
              role: 'admin',
            })
          ).response.status,
          400,
        );
        const registered = await request('/v1/auth/register', {
          email,
          password,
        });
        assert.equal(registered.response.status, 202);
        id = String(registered.data.id);
        await eventually(async () => {
          const login = await request('/v1/auth/login', { email, password });
          if (login.response.status !== 200) return false;
          accessToken = String(login.data.accessToken);
          return true;
        });
        const me = await request('/v1/users/me', undefined, accessToken);
        assert.equal(me.data.role, 'user');
        assert.equal(me.data.balance, '0');
        assert.equal('password' in me.data, false);
        assert.equal('password_hash' in me.data, false);
      },
    );
    await t.test(
      'ordinary users cannot invoke admin credits; wrong password fails',
      async () => {
        assert.equal(
          (
            await request(
              `/v1/admin/users/${id}/credits`,
              { amount: '100' },
              accessToken,
              randomUUID(),
            )
          ).response.status,
          403,
        );
        assert.equal(
          (
            await request('/v1/auth/login', {
              email,
              password: 'incorrect-password',
            })
          ).response.status,
          401,
        );
      },
    );
    await t.test(
      'admin boundary and ledger preserve points above Number.MAX_SAFE_INTEGER',
      async () => {
        await fixture.dbs.users.query(
          "UPDATE profiles SET role='admin' WHERE id=$1",
          [id],
        );
        const result = await request(
          `/v1/admin/users/${id}/credits`,
          { amount: '9007199254740993' },
          accessToken,
          randomUUID(),
        );
        assert.equal(result.response.status, 200);
        assert.equal(result.data.balance, '9007199254740993');
        await fixture.dbs.users.query(
          "UPDATE profiles SET role='user' WHERE id=$1",
          [id],
        );
        assert.equal(
          (
            await request(
              `/v1/admin/users/${id}/credits`,
              { amount: '1' },
              accessToken,
              randomUUID(),
            )
          ).response.status,
          403,
        );
      },
    );
    let betId = '';
    await t.test(
      'duplicate HTTP commands create one bet, one debit and one contribution',
      async () => {
        const key = randomUUID();
        const correlationId = randomUUID();
        const results = await Promise.all(
          Array.from({ length: 8 }, () =>
            request(
              '/v1/bets',
              { amount: '100' },
              accessToken,
              key,
              correlationId,
            ),
          ),
        );
        for (const result of results) assert.equal(result.response.status, 202);
        betId = String(results[0]!.data.id);
        assert.ok(results.every((result) => result.data.id === betId));
        await eventually(
          async () =>
            (await request(`/v1/bets/${betId}`, undefined, accessToken)).data
              .state === 'lost',
        );
        const conflict = await request(
          '/v1/bets',
          { amount: '101' },
          accessToken,
          key,
        );
        assert.equal(conflict.response.status, 409);
        const me = await request('/v1/users/me', undefined, accessToken);
        assert.equal(me.data.balance, '9007199254740893');
        const ledger = await request(
          '/v1/users/me/ledger',
          undefined,
          accessToken,
        );
        const entries = ledger.data.entries as Array<{
          reference: string;
          delta: string;
        }>;
        assert.equal(
          entries.filter((entry) => entry.reference === `debit:${betId}`)
            .length,
          1,
        );
        assert.equal((await request('/v1/pool')).data.balance, '10');
        const bet = await request(`/v1/bets/${betId}`, undefined, accessToken);
        assert.equal(bet.data.correlationId, correlationId);
      },
    );
    await t.test(
      'insufficient points rejects without changing pool',
      async () => {
        const result = await request(
          '/v1/bets',
          { amount: '9223372036854775807' },
          accessToken,
          randomUUID(),
        );
        assert.equal(result.response.status, 202);
        await eventually(
          async () =>
            (
              await request(
                `/v1/bets/${String(result.data.id)}`,
                undefined,
                accessToken,
              )
            ).data.state === 'rejected',
        );
        assert.equal((await request('/v1/pool')).data.balance, '10');
      },
    );
    await t.test('another identity cannot read an owned bet', async () => {
      const otherEmail = `other-${randomUUID()}@example.test`;
      const other = await fixture.services.auth.register(
        { email: otherEmail, password },
        randomUUID(),
      );
      await eventually(async () => {
        const rows = await fixture.dbs.auth.query(
          "SELECT id FROM auth_identities WHERE id=$1 AND state='active'",
          [other.id],
        );
        return rows.length === 1;
      });
      const login = await fixture.services.auth.login({
        email: otherEmail,
        password,
      });
      assert.equal(
        (await request(`/v1/bets/${betId}`, undefined, login.accessToken))
          .response.status,
        404,
      );
    });
    await t.test(
      'internal RPC rejects callers without the service credential',
      async () => {
        const invalid = createClients(
          addresses,
          randomBytes(32).toString('hex'),
        );
        try {
          await assert.rejects(invalid.clients.jackpot.getPool({}), {
            code: 'UNAUTHENTICATED',
          });
        } finally {
          invalid.close();
        }
      },
    );
    await t.test(
      'OpenAPI, live readiness and Prometheus metrics are available',
      async () => {
        assert.equal((await request('/live')).response.status, 200);
        assert.equal((await request('/ready')).response.status, 200);
        assert.equal((await request('/docs-json')).response.status, 200);
        const metrics = await fetch(`${url}/metrics`);
        assert.equal(metrics.status, 200);
        assert.match(await metrics.text(), /jackpot_http_requests_total/);
      },
    );
  },
);
