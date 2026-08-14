---
name: tcp-risk-gate
description: Gate high-risk TCP changes involving schema or migrations, authorization, concurrency or idempotency, shared infrastructure, test-harness identity, or transactional compatibility. Use before delivery of those change families; never for routine edits.
---

# TCP Risk Gate

1. Require a live task contract that names the objective, allowed paths/checks, worktree, branch, one writer, commit/push authority, evidence location, and stop conditions. Confirm the exact worktree and branch before editing.
2. Create a contract-impact matrix: changed behavior, affected schema/API/roles/transactions, mutable targets, required evidence, and excluded scope. Stop rather than invent a business rule.
3. For a defect, add or retain a red test that fails on old behavior. Run targeted and affected checks; for structural changes, run one risk-proportionate clean gate after the final edit, never retry-until-green.
4. Before stateful E2E, Compose, containers, migrations, or shared writes, preflight environment identity: repository/worktree, revision, service and database target, test identities, isolation, and single writer. Any mismatch blocks the action.
5. Gate on the exact revision: record commands, output, SHA, residual risk, and failure conditions in the contract's authoritative location. Green evidence ends this workflow; it never authorizes deploy, UAT, Ready, merge, close, or acceptance.

Stop for production, credentials, destructive or shared-database operations without explicit authorization, ambiguous business rules, identity mismatch, unknown ownership, or scope expansion.
