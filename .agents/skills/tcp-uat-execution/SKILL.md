---
name: tcp-uat-execution
description: Execute an explicitly authorized TCP test-environment deployment or real-browser UAT. Use only when a live contract names the environment, identities, mutable records, deployment or retry boundary, and stop conditions; never for routine development testing.
---

# TCP UAT Execution

1. Require a live contract naming the exact reviewed revision, environment and service/database identities, test accounts and roles/relationships, isolated mutable-record prefix and artifact location, single shared-write owner, deployment/retry boundary, and stop conditions. Do not admit another Issue's records, browser context, or runtime.
2. Admit only that revision. Verify health and proxy, migration ledger, roles/relationships and data prerequisites, isolated browser/artifact contexts, and no cross-Issue contamination before any write. Admission is not UAT acceptance.
3. For an application-only deployment, use the canonical protected env-file reference and `--no-deps`; never change PostgreSQL container, volume, or data identity. Never print secrets or directly write, reset, reseed, restore, or clean the database.
4. Use visible Chrome controls and isolated records. Preserve records and artifacts. On interruption, reconcile read-only first; retry once only after proving zero execution and zero write. Unknown or partial writes block that lane.
5. Report executor-observed `OBSERVED_PASS`, `FAIL`, `BLOCKED`, or `NOT_RUN` with the revision and evidence. Final user acceptance is human-owned; stop before production, Ready, merge, close, or final acceptance.
