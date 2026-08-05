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
- Heavy or long-running commands require prior user confirmation.

## One writer

- One session is the designated writer for a shared file, branch, or runtime object; parallel sessions may read but must not race writes.
- Shared writes (runtime data, evidence artifacts, UAT records) need a single owner and serialization — see the tcp-uat-execution skill.

## GitHub evidence

- Commits and PRs reference the related Issue.
- Verification results, failed attempts, and decision rationale are recorded in Issue comments; a self-report in chat is not final proof (see testing-and-evidence.md).
- No automatic commit, push, merge, deploy, or release; GitHub write operations follow the user-confirmed plan.

## No cross-contamination

- Do not modify files, branches, or PRs owned by another Issue; do not ready or merge another PR.
- Do not mutate runtime data, containers, databases, or user/workspace configuration outside this repository.

## Stop conditions

Stop and ask the user when any of the following hold:

- Authentication, credentials, or MFA are required and unavailable.
- A production target is detected or suspected.
- A destructive delete/reset/restore is requested.
- The hook/plugin/settings schema cannot be verified without guessing.
- The task would expand beyond its declared file scope.
