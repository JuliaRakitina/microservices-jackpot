import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import {
  AuthService,
  checkPassword,
  hashPassword,
  TOKEN_AUDIENCE,
  TOKEN_ISSUER,
  TOKEN_LIFETIME_SECONDS,
} from '../../apps/auth/src/service.js';
import { DomainError } from '../../packages/contracts/src/errors.js';
import type { DomainEvent } from '../../packages/contracts/src/events.js';
import type {
  Database,
  Transaction,
} from '../../packages/runtime/src/database.js';

const secret = randomBytes(32).toString('hex');
const password = 'example-private-passphrase';
const storedHash = await hashPassword(password);
const userId = randomUUID();

function fakeDatabase(rows: Record<string, unknown>[]) {
  const writes: { sql: string; parameters: unknown[] }[] = [];
  const emitted: {
    type: string;
    payload: Record<string, unknown>;
    correlationId: string;
  }[] = [];
  const tx = {
    query: async (sql: string, parameters: unknown[] = []) => {
      writes.push({ sql, parameters });
      return rows;
    },
    emit: async (
      type: string,
      payload: Record<string, unknown>,
      correlationId: string,
    ) => {
      emitted.push({ type, payload, correlationId });
    },
  } as unknown as Transaction;
  const db = {
    query: tx.query,
    transaction: async <T>(fn: (transaction: Transaction) => Promise<T>) =>
      fn(tx),
  } as unknown as Database;
  return { db, tx, writes, emitted };
}

test('password hashes are salted and reject incorrect passwords', async () => {
  const otherHash = await hashPassword(password);
  assert.notEqual(otherHash, storedHash);
  assert.equal(storedHash.includes(password), false);
  assert.equal(await checkPassword(password, storedHash), true);
  assert.equal(await checkPassword('wrong password', storedHash), false);
  assert.equal(await checkPassword(password, 'malformed hash'), false);
});

test('public registration rejects role and unknown fields before writing', async () => {
  const fake = fakeDatabase([]);
  const service = new AuthService(fake.db, secret);
  await assert.rejects(
    service.register(
      { email: 'demo@example.test', password, role: 'admin' },
      randomUUID(),
    ),
    { code: 'INVALID_ARGUMENT' },
  );
  await assert.rejects(
    service.register(
      { email: 'demo@example.test', password: 'short' },
      randomUUID(),
    ),
    { code: 'INVALID_ARGUMENT' },
  );
  assert.equal(fake.writes.length, 0);
});

test('registration writes only a hash and durably emits a normalized ordinary identity', async () => {
  const fake = fakeDatabase([{ id: userId, state: 'pending' }]);
  const correlationId = randomUUID();
  const identity = await new AuthService(fake.db, secret).register(
    { email: ' Demo@Example.Test ', password },
    correlationId,
  );
  assert.deepEqual(identity, { id: userId, state: 'pending' });
  assert.equal(fake.writes[0]?.parameters[1], 'demo@example.test');
  assert.notEqual(fake.writes[0]?.parameters[2], password);
  assert.equal(fake.emitted.length, 1);
  assert.equal(fake.emitted[0]?.type, 'identity.registered');
  assert.deepEqual(Object.keys(fake.emitted[0]?.payload ?? {}).sort(), [
    'email',
    'id',
  ]);
  assert.equal(fake.emitted[0]?.correlationId, correlationId);
  assert.equal(
    await checkPassword(password, String(fake.writes[0]?.parameters[2])),
    true,
  );
});

test('duplicate registration returns a typed conflict and emits no second identity', async () => {
  const fake = fakeDatabase([]);
  await assert.rejects(
    new AuthService(fake.db, secret).register(
      { email: 'demo@example.test', password },
      randomUUID(),
    ),
    { code: 'ALREADY_EXISTS' },
  );
  assert.equal(fake.emitted.length, 0);
});

test('pending profiles cannot log in; wrong credentials reveal no identity state', async () => {
  const fake = fakeDatabase([
    { id: userId, state: 'pending', password_hash: storedHash },
  ]);
  const service = new AuthService(fake.db, secret);
  await assert.rejects(
    service.login({ email: 'demo@example.test', password }),
    { code: 'FAILED_PRECONDITION' },
  );
  await assert.rejects(
    service.login({ email: 'demo@example.test', password: 'wrong password' }),
    { code: 'UNAUTHENTICATED', message: 'Invalid email or password' },
  );
  await assert.rejects(
    new AuthService(fakeDatabase([]).db, secret).login({
      email: 'missing@example.test',
      password,
    }),
    { code: 'UNAUTHENTICATED', message: 'Invalid email or password' },
  );
});

test('login issues identity-only tokens with issuer, audience and 15-minute expiry', async () => {
  const fake = fakeDatabase([
    { id: userId, state: 'active', password_hash: storedHash },
  ]);
  const service = new AuthService(fake.db, secret);
  const response = await service.login({
    email: 'demo@example.test',
    password,
  });
  const claims = jwt.verify(response.accessToken, secret) as jwt.JwtPayload;
  assert.equal(response.expiresIn, TOKEN_LIFETIME_SECONDS);
  assert.equal(claims.sub, userId);
  assert.equal(claims.role, undefined);
  assert.equal(claims.iss, TOKEN_ISSUER);
  assert.equal(claims.aud, TOKEN_AUDIENCE);
  assert.equal((claims.exp ?? 0) - (claims.iat ?? 0), 900);
  assert.deepEqual(await service.verify({ token: response.accessToken }), {
    id: userId,
  });
});

test('verification rejects forged, expired, wrong-audience and inactive identities', async () => {
  const service = new AuthService(
    fakeDatabase([{ id: userId, state: 'active' }]).db,
    secret,
  );
  const options = {
    subject: userId,
    issuer: TOKEN_ISSUER,
    audience: TOKEN_AUDIENCE,
    expiresIn: 900,
  };
  const invalidTokens = [
    jwt.sign({}, randomBytes(32).toString('hex'), options),
    jwt.sign({}, secret, { ...options, expiresIn: -1 }),
    jwt.sign({}, secret, { ...options, audience: 'other-app' }),
    jwt.sign({}, secret, { ...options, issuer: 'other-issuer' }),
    jwt.sign({}, secret, { ...options, algorithm: 'HS384' }),
    jwt.sign({}, secret, {
      subject: userId,
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
    }),
  ];
  for (const token of invalidTokens)
    await assert.rejects(service.verify({ token }), {
      code: 'UNAUTHENTICATED',
    });
  const token = jwt.sign({}, secret, options);
  await assert.rejects(
    new AuthService(
      fakeDatabase([{ id: userId, state: 'pending' }]).db,
      secret,
    ).verify({ token }),
    { code: 'UNAUTHENTICATED' },
  );
  await assert.rejects(
    new AuthService(fakeDatabase([]).db, secret).verify({ token }),
    { code: 'UNAUTHENTICATED' },
  );
});

test('profile event activates an existing identity, validates payloads and rejects orphans', async () => {
  const fake = fakeDatabase([{ id: userId }]);
  const event: DomainEvent = {
    id: randomUUID(),
    type: 'profile.created',
    schemaVersion: 1,
    correlationId: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: { id: userId },
  };
  const service = new AuthService(fake.db, secret);
  await service.handle(event, fake.tx);
  assert.deepEqual(fake.writes[0]?.parameters, [userId]);
  await assert.rejects(
    service.handle(
      // @ts-expect-error Deliberately bypass the typed contract to test runtime rejection.
      { ...event, payload: { id: userId, role: 'admin' } },
      fake.tx,
    ),
    { code: 'INVALID_ARGUMENT' },
  );
  await assert.rejects(
    service.handle(event, fakeDatabase([]).tx),
    (error: unknown) =>
      error instanceof DomainError && error.code === 'FAILED_PRECONDITION',
  );
});
