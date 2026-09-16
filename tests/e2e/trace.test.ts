import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { z } from 'zod';
import { createGateway } from '../../apps/gateway/src/app.js';
import { createClients, serveRpc } from '../../packages/contracts/src/rpc.js';
import {
  startTracing,
  stopTracing,
} from '../../packages/observability/src/index.js';
import {
  createFixture,
  eventually,
} from '../../packages/testing/src/fixture.js';

const attributeSchema = z.object({
  key: z.string(),
  value: z.object({ stringValue: z.string().optional() }).passthrough(),
});
const spanSchema = z
  .object({
    name: z.string(),
    traceId: z.string(),
    spanId: z.string(),
    parentSpanId: z.string().optional(),
    attributes: z.array(attributeSchema).default([]),
  })
  .passthrough();
const exportSchema = z
  .object({
    resourceSpans: z.array(
      z
        .object({
          scopeSpans: z.array(
            z.object({ spans: z.array(spanSchema) }).passthrough(),
          ),
        })
        .passthrough(),
    ),
  })
  .passthrough();

test(
  'OTLP export proves HTTP, gRPC and event trace propagation without credential attributes',
  { timeout: 180_000 },
  async (t) => {
    const payloads: unknown[] = [];
    const collectorErrors: Error[] = [];
    const collector = createServer((request, response) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      request.on('data', (chunk: Buffer) => {
        bytes += chunk.byteLength;
        if (bytes > 1024 * 1024)
          request.destroy(new Error('Unexpectedly large trace export'));
        else chunks.push(chunk);
      });
      request.on('error', (error) => collectorErrors.push(error));
      request.on('end', () => {
        try {
          assert.equal(request.url, '/v1/traces');
          assert.match(
            request.headers['content-type'] ?? '',
            /^application\/json/,
          );
          payloads.push(
            JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown,
          );
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end('{}');
        } catch (error) {
          collectorErrors.push(
            error instanceof Error
              ? error
              : new Error('Invalid collector request'),
          );
          response.writeHead(400);
          response.end();
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      collector.once('error', reject);
      collector.listen(0, '127.0.0.1', resolve);
    });
    const endpoint = `http://127.0.0.1:${(collector.address() as AddressInfo).port}`;
    const settings: Record<string, string | undefined> = {
      OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${endpoint}/v1/traces`,
      OTEL_EXPORTER_OTLP_HEADERS: undefined,
      OTEL_EXPORTER_OTLP_TRACES_HEADERS: undefined,
      OTEL_EXPORTER_OTLP_COMPRESSION: 'none',
      OTEL_EXPORTER_OTLP_TRACES_COMPRESSION: 'none',
      OTEL_SERVICE_NAME: 'jackpot-tracing-test',
      OTEL_TRACES_SAMPLER: 'always_on',
      OTEL_SDK_DISABLED: 'false',
    };
    const previous = Object.fromEntries(
      Object.keys(settings).map((key) => [key, process.env[key]]),
    );
    for (const [key, value] of Object.entries(settings)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    let tracing = false;
    t.after(async () => {
      if (tracing) await stopTracing();
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await new Promise<void>((resolve, reject) =>
        collector.close((error) => (error ? reject(error) : resolve())),
      );
    });
    startTracing();
    tracing = true;

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
      names.map((name, index) => [name, `127.0.0.1:${servers[index]!.port}`]),
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

    const traceId = randomBytes(16).toString('hex');
    const externalParent = randomBytes(8).toString('hex');
    const correlationId = randomUUID();
    const traceparent = `00-${traceId}-${externalParent}-01`;
    const email = `trace-${randomUUID()}@example.test`;
    const password = randomBytes(32).toString('hex');
    const headers = {
      'content-type': 'application/json',
      'x-correlation-id': correlationId,
      traceparent,
    };
    const registration = await fetch(`${url}/v1/auth/register`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email, password }),
    });
    assert.equal(registration.status, 202);
    assert.equal(registration.headers.get('x-correlation-id'), correlationId);
    const identity = z
      .object({ id: z.string().uuid(), state: z.literal('pending') })
      .parse(await registration.json());
    await eventually(
      async () =>
        (
          await fixture.dbs.auth.query(
            "SELECT id FROM auth_identities WHERE id=$1 AND state='active'",
            [identity.id],
          )
        ).length === 1,
    );

    const login = await fetch(`${url}/v1/auth/login`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email, password }),
    });
    assert.equal(login.status, 200);
    const token = z
      .object({ accessToken: z.string(), expiresIn: z.literal(900) })
      .parse(await login.json());
    const profile = await fetch(`${url}/v1/users/me`, {
      headers: { ...headers, authorization: `Bearer ${token.accessToken}` },
    });
    assert.equal(profile.status, 200);
    assert.equal(((await profile.json()) as { id: string }).id, identity.id);

    // These are actual committed outbox envelopes, not a mocked propagation carrier.
    for (const [service, type] of [
      ['auth', 'identity.registered'],
      ['users', 'profile.created'],
    ] as const) {
      const [row] = await fixture.dbs[service].query<{
        event: { correlationId: string; traceparent: string };
      }>(
        "SELECT event FROM outbox WHERE event->>'type'=$1 AND event->'payload'->>'id'=$2",
        [type, identity.id],
      );
      assert.ok(row, `Missing durable ${type} event`);
      assert.equal(row.event.correlationId, correlationId);
      assert.match(
        row.event.traceparent,
        new RegExp(`^00-${traceId}-[0-9a-f]{16}-01$`),
      );
    }

    // Shutdown awaits BatchSpanProcessor flush and the real local HTTP export.
    await stopTracing();
    tracing = false;
    assert.deepEqual(collectorErrors, []);
    assert.ok(payloads.length > 0, 'No OTLP trace payload was exported');
    const spans = payloads.flatMap((payload) =>
      exportSchema
        .parse(payload)
        .resourceSpans.flatMap((resource) =>
          resource.scopeSpans.flatMap((scope) => scope.spans),
        ),
    );
    const expected = [
      'HTTP POST',
      'HTTP GET',
      'grpc.client.auth.register',
      'grpc.server.auth.register',
      'event.identity.registered',
      'event.profile.created',
      'grpc.client.auth.login',
      'grpc.server.auth.login',
      'grpc.client.auth.verify',
      'grpc.server.auth.verify',
      'grpc.client.users.getUser',
      'grpc.server.users.getUser',
    ];
    for (const name of expected) {
      const matching = spans.filter(
        (span) => span.name === name && span.traceId === traceId,
      );
      assert.ok(
        matching.length > 0,
        `Expected exported span ${name} in supplied trace`,
      );
      for (const span of matching)
        assert.equal(
          span.attributes.find(
            (attribute) => attribute.key === 'correlation.id',
          )?.value.stringValue,
          correlationId,
        );
    }
    const registerClient = spans.find(
      (span) => span.name === 'grpc.client.auth.register',
    )!;
    const registerServer = spans.find(
      (span) => span.name === 'grpc.server.auth.register',
    )!;
    const identityConsumer = spans.find(
      (span) => span.name === 'event.identity.registered',
    )!;
    const profileConsumer = spans.find(
      (span) => span.name === 'event.profile.created',
    )!;
    assert.equal(registerServer.parentSpanId, registerClient.spanId);
    assert.equal(identityConsumer.parentSpanId, registerServer.spanId);
    assert.equal(profileConsumer.parentSpanId, identityConsumer.spanId);
    assert.ok(
      spans.some(
        (span) =>
          span.name === 'HTTP POST' && span.parentSpanId === externalParent,
      ),
    );

    const exported = JSON.stringify(payloads);
    for (const value of [
      email,
      password,
      token.accessToken,
      internalToken,
      fixture.jwtSecret,
    ]) {
      assert.ok(
        !exported.includes(value),
        'Trace export must not contain credentials or email values',
      );
    }
    for (const span of spans) {
      assert.equal(
        span.attributes.some((attribute) =>
          /password|authorization|email|(^|[._])jwt($|[._])|(^|[._])token($|[._])/i.test(
            attribute.key,
          ),
        ),
        false,
        'Trace attributes must exclude credential fields',
      );
    }
  },
);
