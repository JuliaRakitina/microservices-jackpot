# ADR 0001: Preserve an explicit original baseline

- Status: accepted
- Date: 2026-09-16

## Context

The 2022 repository has five separate NestJS 8 packages, duplicated generated contracts and Compose configuration depending on an absent `.env`. Its latest implementation predates the final README commit. Modernizing without separating these facts would make regression claims unreliable.

## Decision

Record main baseline `1789b56222b134c4f2e464feb7076f1d14c040e5` and implementation baseline `261982a4acae77faf9aa72d28f86d0b6857c9693`. Preserve a sanitized original description, diagram and Postman example under `docs/original-2022`; Git history remains the source for original code. Never copy embedded credentials into new documentation.

An isolated archive of the original SHA was installed and checked. Four packages passed strict installation/build/scaffold-unit/lint commands; Auth failed installation because its TypeORM version conflicts with its Nest adapter. Four e2e suites require an unavailable hardcoded database hostname. Original Compose could not validate without missing environment values. Full details and caveats are in [verification](../verification.md).

## Consequences

The new API and databases can be reviewed as an intentional migration. Passing original scaffold tests is not presented as business coverage. Removing credential literals from the current tree does not erase their historical exposure.
