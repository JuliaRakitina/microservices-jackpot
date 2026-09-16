import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createGateway, mapHttpError } from '../../apps/gateway/src/app.js';
import { DomainError } from '../../packages/contracts/src/errors.js';
import type { RpcClients } from '../../packages/contracts/src/rpc.js';

test('HTTP mapping translates domain and gRPC failures and hides internal details', () => {
  assert.deepEqual(
    mapHttpError(new DomainError('PERMISSION_DENIED', 'Admin required')),
    { status: 403, code: 'PERMISSION_DENIED', message: 'Admin required' },
  );
  assert.deepEqual(
    mapHttpError({ code: 4, details: 'private-service:5000 timeout' }),
    {
      status: 503,
      code: 'UNAVAILABLE',
      message: 'Service temporarily unavailable',
    },
  );
  assert.deepEqual(
    mapHttpError(new DomainError('INTERNAL', 'password=should-not-leak')),
    { status: 500, code: 'INTERNAL', message: 'Internal server error' },
  );
  assert.equal(
    mapHttpError(new Error('private SQL')).message,
    'Internal server error',
  );
});

test('gateway validates HTTP boundaries and obtains authoritative roles from Users', async (t) => {
  const userId = randomUUID();
  const betId = randomUUID();
  let role = 'user';
  let ready = true;
  let registered = 0;
  let credited = 0;
  let submitted = 0;
  let seenCorrelation: string | undefined;
  let seenLedgerRequest: { id: string; cursor?: string } | undefined;
  const clients: RpcClients = {
    auth: {
      register: async (_request, correlationId) => {
        registered++;
        seenCorrelation = correlationId;
        return { id: userId, state: 'pending' };
      },
      login: async () => ({ accessToken: 'test-token', expiresIn: 900 }),
      verify: async ({ token }) => {
        if (token !== 'test-token')
          throw new DomainError('UNAUTHENTICATED', 'Invalid token');
        return { id: userId };
      },
    },
    users: {
      getUser: async ({ id }) => ({
        id,
        email: 'demo@example.test',
        role,
        balance: '1000',
      }),
      getLedger: async (request) => {
        seenLedgerRequest = request;
        return { entries: [], nextCursor: '' };
      },
      credit: async ({ id }) => {
        credited++;
        return {
          id,
          email: 'demo@example.test',
          role: 'user',
          balance: '1100',
        };
      },
    },
    bets: {
      submit: async ({ userId: owner, amount }, correlationId) => {
        submitted++;
        return {
          id: betId,
          userId: owner,
          amount,
          state: 'funds_pending',
          payout: '0',
          correlationId: correlationId ?? '',
        };
      },
      getBet: async ({ id, userId: owner }) => ({
        id,
        userId: owner,
        amount: '100',
        state: 'lost',
        payout: '0',
        correlationId: randomUUID(),
      }),
    },
    jackpot: { getPool: async () => ({ balance: '10', round: '1' }) },
  };
  const app = await createGateway(clients, async () => ready);
  await app.listen(0, '127.0.0.1');
  t.after(async () => app.close());
  const base = await app.getUrl();
  const post = (
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  const auth = { authorization: 'Bearer test-token' };
  const command = { ...auth, 'idempotency-key': 'demo-key-123' };

  await t.test(
    'registration rejects caller-selected role and unknown properties',
    async () => {
      const response = await post('/v1/auth/register', {
        email: 'demo@example.test',
        password: 'private-passphrase',
        role: 'admin',
      });
      assert.equal(response.status, 400);
      assert.equal(registered, 0);
      const body = await response.json();
      assert.equal(body.error.code, 'INVALID_ARGUMENT');
      assert.equal(
        body.correlationId,
        response.headers.get('x-correlation-id'),
      );
    },
  );

  await t.test(
    'accepted registration propagates correlation and returns no credentials',
    async () => {
      const correlationId = randomUUID();
      const response = await post(
        '/v1/auth/register',
        { email: 'demo@example.test', password: 'private-passphrase' },
        { 'x-correlation-id': correlationId },
      );
      assert.equal(response.status, 202);
      assert.equal(response.headers.get('x-correlation-id'), correlationId);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await response.json(), { id: userId, state: 'pending' });
      assert.equal(seenCorrelation, correlationId);
    },
  );

  await t.test(
    'authenticated endpoints reject absent or invalid tokens',
    async () => {
      assert.equal((await fetch(`${base}/v1/users/me`)).status, 401);
      assert.equal(
        (
          await fetch(`${base}/v1/users/me`, {
            headers: { authorization: 'Bearer wrong' },
          })
        ).status,
        401,
      );
    },
  );

  await t.test(
    'ledger forwards a bounded cursor and rejects malformed query fields',
    async () => {
      const first = await fetch(`${base}/v1/users/me/ledger`, {
        headers: auth,
      });
      assert.equal(first.status, 200);
      assert.deepEqual(await first.json(), { entries: [], nextCursor: '' });
      assert.deepEqual(seenLedgerRequest, { id: userId });
      const next = await fetch(
        `${base}/v1/users/me/ledger?cursor=9007199254740993`,
        { headers: auth },
      );
      assert.equal(next.status, 200);
      assert.deepEqual(seenLedgerRequest, {
        id: userId,
        cursor: '9007199254740993',
      });
      for (const query of [
        'cursor=',
        'cursor=-1',
        'cursor=01',
        'cursor=1.5',
        'cursor=1e3',
        'cursor=9223372036854775808',
        'cursor=1&cursor=2',
        'cursor=1&limit=200',
        'userId=someone-else',
      ]) {
        const response = await fetch(`${base}/v1/users/me/ledger?${query}`, {
          headers: auth,
        });
        assert.equal(response.status, 400, query);
        assert.equal((await response.json()).error.code, 'INVALID_ARGUMENT');
      }
    },
  );

  await t.test(
    'ordinary user cannot credit points and current Users role grants access',
    async () => {
      const denied = await post(
        `/v1/admin/users/${userId}/credits`,
        { amount: '100' },
        command,
      );
      assert.equal(denied.status, 403);
      assert.equal(credited, 0);
      role = 'admin';
      const allowed = await post(
        `/v1/admin/users/${userId}/credits`,
        { amount: '100' },
        command,
      );
      assert.equal(allowed.status, 200);
      assert.equal(credited, 1);
      role = 'user';
      assert.equal(
        (
          await post(
            `/v1/admin/users/${userId}/credits`,
            { amount: '100' },
            command,
          )
        ).status,
        403,
      );
      assert.equal(credited, 1);
    },
  );

  await t.test(
    'stake and idempotency validation rejects floats, numbers and arbitrary owners',
    async () => {
      for (const body of [
        { amount: 100 },
        { amount: '1.5' },
        { amount: '0' },
        { amount: '-1' },
        { amount: '010' },
        { amount: '9223372036854775808' },
        { amount: '100', userId: randomUUID() },
      ]) {
        assert.equal((await post('/v1/bets', body, command)).status, 400);
      }
      assert.equal(
        (await post('/v1/bets', { amount: '100' }, auth)).status,
        400,
      );
      assert.equal(submitted, 0);
    },
  );

  await t.test(
    'bet ownership comes from the verified identity and is retained by GET',
    async () => {
      const response = await post('/v1/bets', { amount: '100' }, command);
      assert.equal(response.status, 202);
      assert.equal((await response.json()).userId, userId);
      const get = await fetch(`${base}/v1/bets/${betId}`, { headers: auth });
      assert.equal(get.status, 200);
      assert.equal((await get.json()).userId, userId);
      assert.equal(
        (await fetch(`${base}/v1/bets/invalid-id`, { headers: auth })).status,
        400,
      );
    },
  );

  await t.test(
    'body parser rejects malformed and oversized JSON with consistent errors',
    async () => {
      const malformed = await fetch(`${base}/v1/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{',
      });
      assert.equal(malformed.status, 400);
      assert.equal((await malformed.json()).error.code, 'INVALID_ARGUMENT');
      const large = await post('/v1/auth/login', {
        email: 'demo@example.test',
        password: 'x'.repeat(20_000),
      });
      assert.equal(large.status, 413);
      assert.equal((await large.json()).error.code, 'INVALID_ARGUMENT');
    },
  );

  await t.test(
    'liveness survives dependency failure while readiness reports it',
    async () => {
      assert.equal((await fetch(`${base}/ready`)).status, 200);
      ready = false;
      assert.equal((await fetch(`${base}/ready`)).status, 503);
      assert.equal((await fetch(`${base}/live`)).status, 200);
    },
  );

  await t.test(
    'OpenAPI and low-cardinality request metrics are exposed',
    async () => {
      const document = await fetch(`${base}/docs-json`);
      assert.equal(document.status, 200);
      const spec = await document.json();
      assert.ok(spec.paths['/v1/bets'].post);
      assert.equal(
        spec.paths['/v1/auth/register'].post.requestBody.content[
          'application/json'
        ].schema.additionalProperties,
        false,
      );
      const metrics = await fetch(`${base}/metrics`);
      assert.equal(metrics.status, 200);
      const body = await metrics.text();
      assert.match(body, /jackpot_http_requests_total/);
      assert.equal(body.includes(userId), false);
    },
  );

  await t.test(
    'authentication throttling ignores forged proxy headers and leaves queries available',
    async () => {
      let limited: Response | undefined;
      for (let attempt = 0; attempt < 31; attempt++) {
        const response = await post(
          '/v1/auth/login',
          { email: 'demo@example.test', password: 'private-passphrase' },
          {
            'x-forwarded-for': `192.0.2.${attempt + 1}`,
            forwarded: `for=192.0.2.${attempt + 1}`,
          },
        );
        if (response.status === 429) {
          limited = response;
          break;
        }
        assert.equal(response.status, 200);
      }
      assert.ok(
        limited,
        'Authentication attempts from the same socket peer must be limited',
      );
      assert.equal((await limited.json()).error.code, 'RATE_LIMITED');
      const retryAfter = Number(limited.headers.get('retry-after'));
      assert.ok(retryAfter > 0 && retryAfter <= 60);
      assert.equal(
        (
          await post('/v1/auth/register', {
            email: 'other@example.test',
            password: 'private-passphrase',
          })
        ).status,
        429,
      );
      assert.equal((await fetch(`${base}/v1/pool`)).status, 200);
      assert.equal((await fetch(`${base}/live`)).status, 200);
    },
  );
});
