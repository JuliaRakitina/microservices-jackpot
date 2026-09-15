# Preserved 2022 implementation

Originally implemented in May 2022 as a hiring assessment. The original commit history is preserved; the current version adds production-oriented reliability, security, observability, and concurrency hardening.

- Default-branch baseline (October README update): `1789b56222b134c4f2e464feb7076f1d14c040e5`.
- Last May implementation: `261982a4acae77faf9aa72d28f86d0b6857c9693`, annotated tag `original-2022-submission`.
- No original commits have been rewritten. Use `git show original-2022-submission:path` to inspect the original source.

The diagram is a historical artifact, not the current runtime architecture. The Postman collection is obsolete and has been sanitized (tokens, password bodies and email values replaced by variables). It is not a modern API demo. Old commits retain historical credentials; none should ever be reused.

Baseline checks and modernization verification are recorded in `../verification.md`.
