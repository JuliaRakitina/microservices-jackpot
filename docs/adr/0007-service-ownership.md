# ADR 0007: service-owned databases

**Decision:** Auth owns credentials and activation; Users owns profiles, roles and ledger; Bets owns intent/idempotency/state; Jackpot owns pool/draw/settlement. Gateway owns external HTTP and has no database credentials. One local PostgreSQL process hosts four databases, each with its own login role; cross-database CONNECT privileges are revoked.

Only technical contracts, configuration, telemetry and transaction/broker utilities are shared. Domain services do not synchronously call each other. The gateway uses bounded gRPC calls; durable progress uses the events described in ADR 0003. This removes Auth↔Users and Bets↔Jackpot synchronous cycles.

The explicit administrator bootstrap is a privileged local operator command with Auth/Users access. It is not a service startup hook. Shared internal RPC/broker credentials are an acknowledged local trust boundary; per-service identities and TLS precede any deployment outside it.
