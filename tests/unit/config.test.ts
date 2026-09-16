import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { config } from '../../packages/config/src/index.js';

function environment() {
  const secret = randomBytes(32).toString('hex');
  return {
    SERVICE_NAME: 'auth',
    INTERNAL_TOKEN: secret,
    JWT_SECRET: secret,
    DATABASE_URL: `postgresql://auth:${secret}@localhost/auth`,
    BROKER_URL: `amqp://jackpot:${secret}@localhost/jackpot`,
  };
}
test('validated configuration refuses missing, placeholder and weak secrets', () => {
  const env = environment();
  assert.equal(config(env).service, 'auth');
  for (const key of [
    'JWT_SECRET',
    'INTERNAL_TOKEN',
    'DATABASE_URL',
    'BROKER_URL',
  ] as const) {
    assert.throws(() => config({ ...env, [key]: undefined }));
  }
  assert.throws(() =>
    config({ ...env, JWT_SECRET: 'change-me-change-me-change-me-change-me' }),
  );
  assert.throws(() => config({ ...env, JWT_SECRET: 'a'.repeat(64) }));
  assert.throws(() =>
    config({
      ...env,
      DATABASE_URL: 'postgresql://auth:password@localhost/auth',
    }),
  );
  assert.throws(() =>
    config({ ...env, BROKER_URL: 'amqp://guest:guest@localhost/' }),
  );
});
test('gateway configuration requires internal authentication without domain database access', () => {
  const settings = config({
    SERVICE_NAME: 'gateway',
    INTERNAL_TOKEN: randomBytes(32).toString('hex'),
  });
  assert.equal(settings.databaseUrl, undefined);
  assert.equal(settings.jwtSecret, undefined);
});
