---
description: Repository/host boundaries, one-writer rule, GitHub evidence discipline, and stop conditions. Applies to every TCP session.
---

# Delivery Boundaries

## Repository boundary

- Work only inside this repository (the main checkout or its declared worktrees under `/opt/personal-agent-workspace/worktrees/`).
- Reads across the workspace are fine; writes outside this repository are not.
- Before any push, verify `git remote -v` shows this repo's own origin (https://github.com/yinhui198456/team-capability-platform.git). Never push to another repository's remote.

## Host constraints

- The host is constrained (2 vCPU / 8 GB). Do not start browsers, Docker/Compose services, databases, migrations, application deployment, UAT, or full product test suites unless an authorized rule/skill (e.g. tcp-uat-execution) explicitly calls for it.
- Heavy or long-running operations require live task-level authorization; without it, stop before running them.
- The canonical runtime checkout (`/opt/personal-agent-workspace/team-capability-platform`) is not a write root for sessions in this worktree — runtime/container/DB/migration mutations there require explicit live-task authorization.

## One writer

- One session is the designated writer for a shared file, branch, or runtime object; parallel sessions may read but must not race writes.
- Shared writes (runtime data, evidence artifacts, UAT records) need a single owner and serialization — see the tcp-uat-execution skill.

## GitHub evidence

- Commits and PRs reference the related Issue where one exists.
- Verification results, failed attempts, and decision rationale are recorded in the task's declared authoritative location — the GitHub PR/Issue when applicable, plus versioned artifacts and check outputs (see testing-and-evidence.md); a self-report in chat is not final proof. An independent maintenance PR does not require Issue comments.
- Durable governance never grants deployment, UAT, or merge authority. A verified live task instruction may authorize bounded edits, risk-proportionate tests, normal commit/push, Draft PR creation, UAT, or deployment within its explicit scope and stop conditions; routine steps already covered by that authorization do not need re-confirmation. Without live authorization, stop before mutations. No automatic commit, push, merge, deploy, or release.

## No cross-contamination

- Do not modify files, branches, or PRs owned by another Issue; do not ready or merge another PR.
- Do not mutate runtime data, containers, databases, or user/workspace configuration outside this repository.

## Stop conditions

Stop and ask the user when any of the following hold:

- Authentication, credentials, or MFA are required and unavailable.
- A production target is detected or suspected.
- A destructive delete/reset/restore is requested.
- Ownership of a file, branch, remote, or runtime object is unknown, or the target of a command is unclear.
- A business-rule choice is required (the design is silent on which behavior is correct).
- The task would expand beyond its declared file scope.
- The hook/plugin/settings schema cannot be verified without guessing.
