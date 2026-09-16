# ADR 0002: One workspace, current LTS runtime and versioned contracts

- Status: accepted
- Date: 2026-09-16

## Context

Independent package locks and repeated protobuf copies drifted. NestJS 12 ships ESM packages; runtime and compilation conventions need to agree.

## Decision

Use a private npm workspace with one lockfile, Node.js 24, NestJS 12, strict TypeScript with NodeNext ESM, and TypeORM 0.3 over PostgreSQL 17. Keep `.js` extensions in relative TypeScript imports for predictable emitted ESM resolution. Build one shared application image and choose the service entrypoint at runtime. Pin external images by published patch tag and multi-platform digest, and run application containers as the non-root Node user.

The choice follows the [official Node release schedule](https://nodejs.org/en/about/previous-releases) and the [Nest 12 migration guide](https://docs.nestjs.com/migration-guide), which documents ESM packaging and distinct application/CLI Node requirements. We compile directly with TypeScript rather than depending on framework scaffolding at runtime.

Keep protobuf contracts in `packages/contracts/proto/jackpot/v1`; generate TypeScript with pinned Buf and ts-proto tools. CI lints contracts, regenerates outputs and rejects a generated-file diff. Share contracts and technical runtime only; domain schemas remain service-owned.

## Consequences

Installation and upgrades are reproducible and coordinated. One workspace makes cross-service changes easier, but shared technical changes require all-service verification. Contract field numbers and the `v1` namespace are compatibility boundaries; a new breaking contract requires an explicit version transition.
