# ADR 0004: Explicit simulator rules and a breaking v1 migration

- Status: accepted
- Date: 2026-09-16

## Context

The original implementation used a threshold-based winner rule and exposed a withdrawal workflow. Preserving those names while changing transactional behavior would conceal a business change.

## Decision

Publish a new `/v1` API with fresh, service-owned databases. All amounts are simulated integer points. Each accepted stake contributes `floor(stake / 10)` to the shared pool. Each settlement draws an integer uniformly from 0 through 99 using cryptographic randomness; draw zero wins. Payout includes the winning stake's contribution, resets the pool to zero and advances its round. The result and draw algorithm version are stored with the settlement. Winning points are credited automatically; there is no external withdrawal or real-money integration.

Use injected draw selection in deterministic tests; the HTTP demo accepts either win or loss and verifies accounting in both cases. Registration always creates a regular zero-balance user. Only an explicitly bootstrapped administrator may add simulated points through the credit endpoint.

## Consequences

This is an intentional replacement for the original winner/withdrawal semantics, not a compatibility claim. Old clients and database volumes cannot be reused unchanged. The reference offers no guarantee of fairness certification or suitability for operating a real-money product. Migrating historical balances or pending bets needs a separate reconciliation plan and is outside this clean-schema implementation.
