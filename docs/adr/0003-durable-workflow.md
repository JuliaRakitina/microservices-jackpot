# ADR 0003: Transactional outbox, inbox and point ledger

- Status: accepted
- Date: 2026-09-16

## Context

A synchronous chain spanning bet creation, balance debit and jackpot settlement can fail after any subset of writes. Retrying that chain can double-charge or pay twice. A broker alone does not make database state and messages atomic.

## Decision

Use service-local transactions and an explicit asynchronous bet workflow. Store a domain change and outgoing events together in PostgreSQL. Publish persistent events to RabbitMQ 4.3 durable quorum queues using confirms. Commit each inbox record with its domain effects before acknowledging consumption. Retain retries and dead-letter evidence for operator repair/replay. Deduplicate both envelope IDs and business references because a logical duplicate can arrive with a different envelope ID.

[Publisher confirms and consumer acknowledgements](https://www.rabbitmq.com/docs/confirms) cover different hops; a broker confirm does not prove the receiving service committed its transaction. [Quorum queues](https://www.rabbitmq.com/docs/quorum-queues) provide durable replicated queue semantics, but local single-node deployment cannot survive the loss of its only node.

Use integer `BIGINT` points, canonical string API amounts, row locks and unique ledger references. Record the selected draw and settlement once. Require completion acknowledgement after Users applies the payout before Bets becomes final.

## Consequences

Reads may observe intermediate states. Delivery is at least once, with idempotent database effects. A failed settlement remains durably pending until recovery; no timeout-based refund is added after a possible jackpot decision. This avoids inventing a distributed rollback that the system cannot safely guarantee. Throughput is bounded by account contention and the single pool lock, appropriate for this reference implementation.
