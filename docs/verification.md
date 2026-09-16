# Verification record

## Original 2022 baseline: executed

Baseline source: `1789b56222b134c4f2e464feb7076f1d14c040e5`; latest implementation: `261982a4acae77faf9aa72d28f86d0b6857c9693`. Commands ran on 2026-09-16 in an isolated Git archive under Node 24.13.0/npm 11.6.2. The original mutating lint script ran only in that archive.

| Original package | Clean install                   | Build   | Unit            | Lint             | E2E                                  |
| ---------------- | ------------------------------- | ------- | --------------- | ---------------- | ------------------------------------ |
| gateway          | Pass                            | Pass    | 1 scaffold test | Pass, 4 warnings | 1 scaffold test passes               |
| user-srv         | Pass                            | Pass    | 1 scaffold test | Pass, 3 warnings | Fails: unavailable database hostname |
| bet-srv          | Pass                            | Pass    | 1 scaffold test | Pass             | Fails: unavailable database hostname |
| jackpot-srv      | Pass                            | Pass    | 1 scaffold test | Pass, 1 warning  | Fails: unavailable database hostname |
| auth-srv         | Fails: peer dependency conflict | Blocked | Blocked         | Blocked          | See diagnostic below                 |

Commands: `npm ci --no-audit --no-fund`, `npm run build`, `npm test -- --runInBand`, `npm run lint`, `npm run test:e2e -- --runInBand`.

Auth requires TypeORM 0.3.6 while its Nest adapter requires TypeORM ^0.2.34. A separately labeled diagnostic installation using `--legacy-peer-deps` allowed Auth build, unit and lint to pass; its e2e then failed on the same unavailable database hostname. This does not repair the strict baseline. Unit tests only assert the scaffold `Hello World!` controller. Lint auto-fixed one archived gateway file, so lint success is a post-fix result.

Original Compose validation failed because environment values were absent and port expressions became empty. No original containers were started. A location-only original scan found four inline database passwords, one JWT secret, 14 JWT literals, five example passwords and five email identifiers in Postman, plus one collection UUID. Values were withheld; current-tree sanitization does not remove secrets from historical commits. The scan was heuristic and did not establish absence of all secrets.

## Modernized implementation: executed results

Local tools: Node 24.13.0, npm 11.6.2, Docker Desktop Engine 29.5.3, Compose 5.1.4. Application images use pinned Node 24.21.0, PostgreSQL 17.11 and RabbitMQ 4.3.5. Tests use real disposable containers, never a mocked database/broker.

| Command                                                                                    | Result                                                                                                                                                     |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci --no-audit --no-fund`                                                              | Clean install passes from the single lockfile                                                                                                              |
| `npm run format:check`                                                                     | Pass                                                                                                                                                       |
| `npm run lint`                                                                             | Pass                                                                                                                                                       |
| `npm run typecheck` / `npm run build`                                                      | Pass, strict TypeScript                                                                                                                                    |
| `npm test`                                                                                 | 37 passing test nodes (36 leaf scenarios)                                                                                                                  |
| `npm run test:contracts`                                                                   | 3 passing scenarios                                                                                                                                        |
| `npm run test:integration`                                                                 | 13 passing nodes (12 leaf scenarios)                                                                                                                       |
| `npm run test:e2e`                                                                         | 10 passing nodes (9 leaf scenarios)                                                                                                                        |
| `npm run test:resilience`                                                                  | 5 passing nodes (4 leaf scenarios)                                                                                                                         |
| `npm run contracts:lint` / `npm run contracts:generate`                                    | Pass                                                                                                                                                       |
| `npm run contracts:breaking`                                                               | Explicit first-v1 migration handling: original base has only incompatible legacy contracts; a negative test proves future incompatible v1 changes fail Buf |
| `npm run scan:secrets`                                                                     | Current tracked/non-ignored tree passes heuristic scan                                                                                                     |
| `npm run scan:gitleaks`                                                                    | Pinned Gitleaks 8.30.1 current-tree snapshot: zero findings, no custom allowlist                                                                           |
| `npm audit --audit-level=high`                                                             | Zero reported vulnerabilities at all severities                                                                                                            |
| `npm run setup` / `docker compose config --quiet`                                          | Pass; generated secrets, existing configuration preserved                                                                                                  |
| `docker compose up --build -d --wait --wait-timeout 180`                                   | Images build and dependencies become healthy; first gateway bind failed because another application already owned host port 3000                           |
| `GATEWAY_PORT=3300` in local `.env`, then `docker compose up -d --wait --wait-timeout 180` | All seven required containers healthy                                                                                                                      |
| `docker compose build gateway` + healthy startup after final runtime fixes                 | Pass                                                                                                                                                       |
| `npm run demo`                                                                             | Pass: one bet/one debit, correlation ID, initial1000 → final900, losing payout0, ledger credit1000/debit100                                                |
| `docker compose exec -T gateway id -u`                                                     | `1000`, application runs as non-root                                                                                                                       |
| Auth-role connection to Users database                                                     | PostgreSQL rejects with42501; database ownership isolation verified                                                                                        |

Total: **68 passing test nodes, representing64 leaf scenarios**; four parent grouping nodes are included in Node's reported count. No skips. Generated-code diff verification and remote CI status are recorded in the handoff after commits.

### What each layer proves

- **Unit:** scrypt salting/verification; registration role rejection; pending/active credentials; token expiry/audience/signature; live role revocation; decimal canonicalization/overflow/rounding; winner/loser decisions; invalid transitions; configuration validation; HTTP mapping, payload limits, rate limits and cursor validation. Six runtime regressions exercise late connection shutdown, stalled topology/close handshakes, exhausted retry publication capacity, confirmation timeout and unroutable messages.
- **Contracts:** exact strings beyond2^53 survive protobuf serialization; event envelopes reject incompatible fields; actual Buf invocation accepts unchanged v1 and rejects changed point field types.
- **Integration:** empty/rerun migrations; registration recovery; simultaneous idempotency keys;20 competing stakes cannot overspend;20 accepted stakes retain all contributions; same-ID and semantic/new-ID redelivery; exactly one winning payout; transaction rollback; out-of-order failure; broker stop/start recovery; durable outcome/latency metrics. Pagination separately tests106 ledger rows, exact large cursors, interleaved foreign-user entries, bounded100-entry replies and appends between pages.
- **E2E:** actual HTTP→gRPC→PostgreSQL/RabbitMQ registration/role/credit/bet/ledger flow, cross-user isolation, command retry, insufficient funds and internal RPC authentication. A local OTLP receiver verifies shared trace IDs, parent-child relationships through events, persisted traceparent and absence of credentials/email in trace export.
- **Resilience:** six failed delivery attempts park one event without debit; the operator replay command after repair settles exactly once; restarting a consumer resumes accepted work; database outage makes readiness503 and liveness200.

### Failures found and repaired during verification

Docker may change automatically assigned host ports on container restart; the test fixture now reserves random explicit ports. Independent review found retry publication failures could exhaust consumer prefetch and shutdown could create late connections; both have regression tests. Test cleanup initially closed its broker before a separately owned inspection connection; resource cleanup now runs in reverse order and the full resilience suite exits cleanly. Unbounded ledger responses could exceed the gRPC limit, so sequence-cursor pagination is implemented and tested.

### Boundaries of this evidence

The security scans cover the current tree. Historical literals remain in preserved commits and must not be reused. npm emits a deprecation notice for TypeORM's transitive glob10 dependency, but the advisory audit reports zero vulnerabilities; nothing is hidden by an audit suppression. No penetration test, fairness certification, HA/failover test, backup restoration drill, load benchmark or original-data import has been performed. Local consumer/broker recovery is not proof against loss of every durable storage copy.
