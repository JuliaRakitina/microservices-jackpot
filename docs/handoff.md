# Modernization record

## Preservation and integration

- The 2026 modernization was merged into `main` through [PR #1](https://github.com/JuliaRakitina/microservices-jackpot/pull/1) on September 16, 2026.
- Original default-branch baseline: `1789b56222b134c4f2e464feb7076f1d14c040e5`.
- Original May implementation: `261982a4acae77faf9aa72d28f86d0b6857c9693`, annotated tag `original-2022-submission`.
- All 17 original commits, including the baseline, remain byte-for-byte unchanged. No license was added.
- Modernization commits use `Julia Rakitina <julia.rakitina@gmail.com>` as both author and committer; the annotated tag uses the same personal tagger identity. The authorship correction preserved commit trees, messages, dates and order, as well as the tag target and annotation.

## Modernization commits before the event-contract follow-up

| Commit    | Change                                                                                                                      |
| --------- | --------------------------------------------------------------------------------------------------------------------------- |
| `77f3f60` | Preserve historical diagram, sanitize Postman examples, record exact baseline/tag                                           |
| `e935b8f` | One strict workspace, canonical contracts, secure identity, integer ledger, durable saga, outbox/inbox, locks and telemetry |
| `6b1445e` | Unit/contract/real-dependency/concurrency/E2E/recovery/trace/pagination tests                                               |
| `91cb119` | Pinned containers, generated configuration, CI, operator tools, demo and documentation                                      |
| `4201c29` | Narrow a legacy ignore rule so the database initialization script is included in clean clones                               |
| `19924ab` | Verification inventory, explicit point/ownership ADRs and this handoff                                                      |
| `462a9bf` | Wait for authenticated AMQP consumer readiness before opening the resilience inspection connection                          |

These SHAs reflect the personal-authorship rewrite. The final row fixes a Linux startup race without fixed sleeps or changed domain semantics.

## Baseline and implementation

[Verification](verification.md) records exact commands and failures: Auth's clean install failed on incompatible TypeORM generations; four database E2E suites failed on the unavailable original hostname; Compose lacked required environment configuration. Original tests were scaffold checks. Audit confirmed public role assignment, inline credentials, floating-point contributions, missing debit, unlocked pool/balance mutations and duplicate-payout risk.

The final architecture keeps Gateway/Auth/Users/Bets/Jackpot with separate owned databases. Gateway makes gRPC calls; domain progress flows through RabbitMQ. Synchronous Auth↔Users and Bets↔Jackpot cycles are gone. Registration and settlement have durable pending states. Row locks, exact bigint arithmetic, unique command/business keys and inbox/outbox transactions protect value mutations.

## Event-contract follow-up

All eight broker events now share a discriminated contract in `packages/contracts/src/events.ts`, with strict typed payloads and required `schemaVersion: 1`. Generic `Transaction.emit` rejects mismatched event/payload pairs at compile time and validates the complete envelope before outbox insertion. Consumers validate the same schema before inbox or domain writes; handlers reuse the canonical payload schemas. The runtime subscription map is the only source for durable bindings and consumer admission.

Contract tests cover every schema, malformed payloads, unknown fields, missing/unsupported versions, exact point bounds and producer-side rejection before writes. Typecheck tests preserve discriminator/payload correlation; consumer boundary tests verify rejection, durable retry/parking and confirmation-before-acknowledgment. Unversioned pending messages require draining with the old services or a deliberate disposable-data reset; see [architecture](architecture.md).

## Executed verification

Local clean install, formatting, lint, strict build/typecheck, protobuf lint/regeneration, dependency/secret scans, Compose health and demo passed. Tests: **41 unit, 11 contract, 13 integration, 10 E2E, 5 resilience nodes**, totaling **80 nodes / 76 leaf scenarios**, with no skips. Tests include real concurrent overspend/pool mutation, duplicate IDs and logical redelivery, exactly one winning payout, rollback, broker/consumer restart, failure-queue replay, dependency readiness and OTLP trace propagation. See verification.md for commands and scope.

`npm audit` reported zero vulnerabilities. Pinned Gitleaks 8.30.1 reported zero current-tree findings with default rules; a separate location-only heuristic scan also passed. Original history still contains obsolete literals; never reuse them. A transitive glob deprecation warning remains without a reported advisory.

The CI workflow runs the same checks and a separate clean Compose/demo job. The `main` run for merge commit `c7e6789` completed successfully: [CI #35140045554](https://github.com/JuliaRakitina/microservices-jackpot/actions/runs/35140045554).

## Migration and behavior changes

Use fresh service-owned databases. Startup applies each committed version 1 migration transactionally before readiness; synchronization is disabled. There is no automatic legacy-data import and no promise of old protobuf/HTTP compatibility. V1 points are decimal strings and ledger queries paginate 100 entries using exact sequence cursors.

The original pre-contribution random threshold and manual withdrawal are deliberately replaced: each accepted stake contributes floor(stake/10), remaining points are burned, a cryptographic 1-in-100 draw selects a winner, and the whole resulting pool is automatically paid/reset. Outcomes, draw inputs, algorithm version and payout intent are recorded. This is not independently verifiable fairness.

## Demo

```sh
npm ci
npm run setup
docker compose up --build -d --wait --wait-timeout 180
npm run demo
```

If port 3000 is occupied, set `GATEWAY_PORT=3300` in `.env`. The initial verification used 3300. The event-contract follow-up also passed a fresh isolated `jackpot-contract-check` Compose stack on an allocated host port, then removed only that disposable stack and its volumes. Expected demo: one logical 100-point bet despite retry; ledger credit 1000/debit 100; final balance 900 plus any payout; printed bet/correlation IDs. The recorded local losing run finished with 900 and payout 0. The app runs as UID 1000; Auth credentials cannot connect to the Users database (PostgreSQL 42501).

Keep `.env` with its volumes. `docker compose down` stops services; adding `--volumes` explicitly deletes this project's stored data. No global Docker cleanup is used.

## Threat model, invariants and limits

See [security](security.md), [architecture/recovery](architecture.md), [ADRs](adr/) and [follow-ups](follow-ups.md). This is synthetic-points portfolio software. Internal shared identities/plaintext transport, single-node dependencies, per-process rate limits, missing retention/backup drills and the globally serialized pool remain explicit limits. Failed debits can remain pending for operator repair/replay; no unsafe timeout refund is issued. No production, real-money, compliance, penetration-test, scale or provable-fairness claim is made.

Follow-ups are dependency ordered: deployment identities/TLS, audited recovery operations, retention/backup tests, HA/failover, reproducible capacity measurements, then additional identity/session features if needed. No frontend or decorative cloud stack was added.
