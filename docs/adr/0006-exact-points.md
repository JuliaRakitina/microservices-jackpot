# ADR 0006: exact integer points and an auditable ledger

**Decision:** PostgreSQL BIGINT and TypeScript bigint hold all point values; protobuf/JSON use canonical decimal strings. Commands reject zero, fractional, noncanonical and out-of-range amounts. Pool contributions round down with integer division by ten. The remainder is burned synthetic value.

Users owns an append-only ledger plus cached balance. Both change inside one locked account transaction. Unique business references prevent duplicate credits/debits; tests compare every running balance and the ledger sum with the cached value under concurrency. Cursors also remain decimal strings beyond JavaScript's safe-integer range.

**Consequences:** API clients must treat points as strings. Overflow becomes an explicit error, never truncation. Database administrators remain capable of bypassing append-only triggers. Legacy floating/truncated data has no automatic lossless migration.
