# Threat model and limits

## Assets and trust boundaries

Assets are credential hashes, identity/role integrity, exact synthetic balances, immutable ledger references, bet ownership and settlement decisions. HTTP callers are untrusted. The gateway authenticates through Auth and queries privileged roles from Users. Each service owns one database and credentials; Compose revokes cross-database access. The seed command is an explicit privileged operator tool.

Internal gRPC and RabbitMQ are trusted local-network boundaries. A generated shared RPC token blocks accidental/public calls; it does not stop a compromised internal service impersonating another. RabbitMQ uses one application account. There is no per-service broker ACL, mTLS, managed rotation, external secret manager or perimeter identity service. Do not expose internal services or local metrics/trace tools publicly.

## Controls

- Registration rejects unknown fields, including role; Users assigns `user`.
- Current server-side role lookup governs credits; JWT role claims grant no privileges.
- Asynchronous scrypt: random 128-bit salt, N=32768, r=8, p=1, 64-byte key. Unknown accounts perform comparable password work. Login errors are generic; registration conflicts still reveal existing accounts.
- HS256 validates issuer, audience, identity, expiry and active status. Tokens expire after 15 minutes. No refresh or individual-token revocation; inactive identities fail verification.
- Configuration rejects missing/placeholder credentials. Setup generates independent random values outside Git.
- Request size, field lengths, point ranges, idempotency keys and event schemas are validated. Caller values use bound SQL parameters.
- Per-process authentication throttling reduces cheap abuse. Real deployments need distributed limits.
- Locks, constraints, inbox content checks and append-only ledger entries prevent duplicate effects. Database owners can bypass triggers; storage is not tamper-proof.
- Logs omit payloads and credentials. Traces carry operation metadata instead of personal values.

## Failure boundaries

There are no automatic timeout refunds. Debits can stay pending until downstream recovery or operator repair. Failed events are parked after bounded retries; replay preserves identifiers. Operator changes must reconcile bet intent, reservation, settlement and ledger first. Point/round overflow is visible and may require intervention, never floating-point coercion.

Publisher confirms and acknowledgements cover tested restart/redelivery scenarios, not destruction of durable storage. Single-node dependencies are not HA. Backup/restore, retention, failover, external abuse testing and load testing remain unimplemented.

Historical commits contain obsolete literals because history is preserved. Never reuse them. Current-tree scans and dependency audit are recorded in verification.md. These are not penetration tests or production certification.
