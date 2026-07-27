# Capability Standard Targets Design

## Scope

Issue #49 replaces Member-entered per-item targets with Leader-owned standard targets plus reviewed personal adjustments. It changes only capability model maintenance, Assessment creation/editing, Gap generation, Buddy Assessment Review, persistence, migration, and the four source documents required by the Issue. Assessment page layout redesign and Issue #50 are excluded.

## Target resolution

The service parses `recommended_start_level` as either one P4-P8 level or an inclusive range separated by `-`, `–`, or `—`. The first level is the earliest applicable level. Invalid strings are logged with the L3 code and reject the operation with an actionable client error.

Resolution order is fixed:

1. If the Member target job level is below the earliest applicable level, the L3 is not applicable.
2. Otherwise, an explicit Leader override for the exact job level wins. A numeric override is 1-5; a stored null override means explicitly not applicable.
3. With no override, use P4=2, P5=3, P6=4, P7=5, P8=5.

Overrides below the earliest applicable level are invalid. The UI disables them and the API rejects them. A Leader must first lower `recommended_start_level` to make an earlier job level applicable.

## Persistence and migration

`capability_standard_target_override` stores at most one row per L3 and P4-P8 job level. Row absence means default; a row with a numeric value means override; a row with null means explicit not applicable.

Assessment Detail keeps `target_level` as the effective target used by existing Gap and planning code. It adds immutable snapshot fields for standard applicability and target, adjustment flag/value/reason, and snapshot source. New Assessments snapshot every enabled L3 at creation. Later model, override, or Member job-level changes never recalculate an existing Assessment.

A lightweight versioned migration runner records applied migrations and runs each migration once in a transaction. Existing non-null targets and Gaps are preserved exactly and marked `legacy_preserved`. Only editable legacy drafts with a null target may be resolved once during migration. Rows that cannot be resolved remain readable, carry an actionable compatibility error, and cannot be submitted. No seed is rerun and no history is deleted.

## Assessment writes

Member payloads contain current level, evidence, plan-candidate flag, and optional personal-adjustment fields. They do not accept standard or effective targets. The server locks the Assessment row, validates the whole batch, calculates every effective target and Gap from stored snapshots, and writes atomically. The existing last-write-wins policy remains, but concurrent saves cannot leave partial rows.

Personal adjustment is permitted only for an applicable standard target. It requires a value from 1-5 and a non-empty reason. Not-applicable items cannot be adjusted, do not produce Gap rows, and cannot be plan candidates.

## UI and review

Leader L3 editing shows five controls with three states: use default, numeric 1-5, and not applicable. Controls below `recommended_start_level` are disabled.

Member Assessment shows the standard target read-only and an explicit “申请调整” control for applicable items. Buddy Review shows standard target, adjusted target, reason, effective target, and Gap. The existing `认可 / 建议调整` flow remains unchanged.

## Verification

Backend tests cover parsing, precedence, permissions, invalid overrides, no target job level, snapshot immutability, tamper rejection, adjustment validation, migration compatibility, and concurrent atomic saves. Frontend tests cover all three override states, disabled lower levels, read-only targets, adjustment validation, and Buddy visibility. Playwright covers the Leader-to-Member-to-Buddy business path. Existing Frontend, Backend, E2E, and Docker quality gates remain unchanged.
