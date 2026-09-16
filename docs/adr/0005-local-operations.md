# ADR 0005: Isolated local dependencies and generated credentials

- Status: accepted
- Date: 2026-09-16

## Decision

Compose runs one PostgreSQL 17 instance with four database owners, one RabbitMQ 4.3 node and five application processes. Only the HTTP gateway binds a host port, on loopback. Optional Jaeger tracing and explicit administrator seed tooling use Compose profiles. One image is built through the gateway target and reused by all application services.

`npm run setup` generates independent random secrets and an ignored mode-0600 `.env`; it never silently rotates credentials. Domain services receive only their own database URL. The seed tool alone receives Auth and Users URLs for explicit administrator provisioning. Startup migrations and health checks gate readiness. Credentials are not image build arguments, image layers, log fields or default examples.

External image tags and digests were resolved against Docker Hub on 2026-09-16: Node 24.21.0 bookworm-slim, PostgreSQL 17.11 bookworm, RabbitMQ 4.3.5 management, and Jaeger 2.21.0. Patch and digest updates require rebuilding and rerunning the verification suite. [Jaeger's getting-started guide](https://www.jaegertracing.io/docs/2.10/getting-started/) describes the local all-in-one deployment model and OTLP ingestion.

## Consequences

The local environment is reproducible and secrets do not have fixed demo values. Existing volumes retain their own stored credentials, so changing `.env` is not a password-rotation mechanism. This deliberately small deployment has no node redundancy; operational production controls need their own design and validation.
