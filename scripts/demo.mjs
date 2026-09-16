import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { parseEnv } from 'node:util';

const env = {
  ...parseEnv(await readFile(new URL('../.env', import.meta.url), 'utf8')),
  ...process.env,
};
const base =
  env.DEMO_BASE_URL ?? `http://127.0.0.1:${env.GATEWAY_PORT ?? '3000'}`;
async function request(path, { method = 'GET', body, token, key } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(key ? { 'idempotency-key': key } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(
      `${method} ${path}: HTTP ${response.status}, ${result.error?.code ?? 'UNKNOWN'}`,
    );
    error.code = result.error?.code;
    throw error;
  }
  return result;
}
async function until(label, action, interval = 200) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const result = await action();
    if (result) return result;
    await delay(interval);
  }
  throw new Error(`${label} did not complete within 30 seconds`);
}
function loginWhenActive(email, password) {
  return until(
    'Profile activation',
    async () => {
      try {
        return await request('/v1/auth/login', {
          method: 'POST',
          body: { email, password },
        });
      } catch (error) {
        if (error.code === 'FAILED_PRECONDITION') return undefined;
        throw error;
      }
    },
    1500,
  );
}
await request('/ready');
assert.ok(
  env.DEMO_ADMIN_EMAIL && env.DEMO_ADMIN_PASSWORD,
  'Run npm run setup first',
);
const seeded = spawnSync(
  'docker',
  [
    'compose',
    'run',
    '--rm',
    '--no-deps',
    '-T',
    '-e',
    'ADMIN_EMAIL',
    '-e',
    'ADMIN_PASSWORD',
    'seed-admin',
  ],
  {
    cwd: new URL('..', import.meta.url),
    env: {
      ...env,
      ADMIN_EMAIL: env.DEMO_ADMIN_EMAIL,
      ADMIN_PASSWORD: env.DEMO_ADMIN_PASSWORD,
    },
    encoding: 'utf8',
    timeout: 45000,
  },
);
assert.equal(
  seeded.status,
  0,
  'Admin seed failed; inspect the seed-admin command without exposing its environment',
);
const admin = await loginWhenActive(
  env.DEMO_ADMIN_EMAIL,
  env.DEMO_ADMIN_PASSWORD,
);
const email = `demo-${randomUUID()}@example.invalid`;
const password = randomBytes(24).toString('hex');
await request('/v1/auth/register', {
  method: 'POST',
  body: { email, password },
});
const login = await loginWhenActive(email, password);
const token = login.accessToken;
const user = await request('/v1/users/me', { token });
assert.equal(user.balance, '0');
await request(`/v1/admin/users/${user.id}/credits`, {
  method: 'POST',
  token: admin.accessToken,
  key: randomUUID(),
  body: { amount: '1000' },
});
const key = randomUUID();
const bet = await request('/v1/bets', {
  method: 'POST',
  token,
  key,
  body: { amount: '100' },
});
const duplicate = await request('/v1/bets', {
  method: 'POST',
  token,
  key,
  body: { amount: '100' },
});
assert.equal(
  duplicate.id,
  bet.id,
  'Identical idempotent requests must return the same bet',
);
const settled = await until('Bet settlement', async () => {
  const current = await request(`/v1/bets/${bet.id}`, { token });
  return ['won', 'lost', 'rejected'].includes(current.state)
    ? current
    : undefined;
});
assert.notEqual(
  settled.state,
  'rejected',
  'The funded demo bet must be accepted',
);
const finalUser = await request('/v1/users/me', { token });
assert.equal(BigInt(finalUser.balance), 900n + BigInt(settled.payout));
const ledger = await request('/v1/users/me/ledger', { token });
assert.equal(
  ledger.entries.filter((entry) => entry.reference === `debit:${bet.id}`)
    .length,
  1,
);
console.log(
  JSON.stringify(
    {
      result: 'ok',
      betId: bet.id,
      correlationId: settled.correlationId,
      state: settled.state,
      initialBalance: '1000',
      balance: finalUser.balance,
      payout: settled.payout,
      idempotencyVerified: true,
      ledger: ledger.entries.map(({ delta, balance, reference }) => ({
        delta,
        balance,
        reference,
      })),
    },
    null,
    2,
  ),
);
