"""Issue #65 deterministic synthetic test-data catalog (test-only).

Expresses the 18 live Issue #65 data-matrix dimensions as named, composable
cases plus the confirmed single-team role identities and Buddy assignments.
All identities are synthetic (`i65-` prefix); construction is deterministic —
build_catalog() returns identical frozen objects in identical order on every
call. Catalog construction does NOT execute or pass any business scenario.

DB materialisation reuses the established seams (app.access.repository +
the review_support/standard_target_support UPDATE pattern); no parallel
fixture framework is introduced.
"""

from dataclasses import dataclass, field

import psycopg

from app.access.repository import (
    assign_role,
    create_buddy_relationship,
    create_user,
)

# Mirrors backend/app/access/repository.py _VALID_LEVELS / _ROLE_CODES.
VALID_LEVELS = ("P4", "P5", "P6", "P7", "P8")
ROLE_CODES = frozenset({"Member", "Buddy", "Leader", "Admin"})

# Synthetic test-only password; never a real or UAT credential.
_TEST_PASSWORD = "i65-synthetic-test-only"

PRIORITY_LABELS = ("高", "中", "低", "暂缓")


@dataclass(frozen=True)
class Identity:
    key: str
    username: str
    full_name: str
    roles: tuple[str, ...]
    current_level: str | None
    target_level: str | None


@dataclass(frozen=True)
class BuddyAssignment:
    key: str
    member_key: str
    buddy_key: str


@dataclass(frozen=True)
class Dimension:
    number: int
    key: str
    title: str


@dataclass(frozen=True)
class Case:
    case_id: str
    dimension: int
    key: str
    summary: str
    attributes: tuple[tuple[str, object], ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class Catalog:
    identities: tuple[Identity, ...]
    buddy_assignments: tuple[BuddyAssignment, ...]
    dimensions: tuple[Dimension, ...]
    cases: tuple[Case, ...]


def _attrs(**kwargs: object) -> tuple[tuple[str, object], ...]:
    return tuple(sorted(kwargs.items()))


def _case(
    case_id: str,
    dimension: int,
    key: str,
    summary: str,
    **attributes: object,
) -> Case:
    return Case(case_id, dimension, key, summary, _attrs(**attributes))


_IDENTITIES: tuple[Identity, ...] = (
    Identity("i65-member-a", "i65-member-a", "I65 Member A", ("Member",), "P4", "P4"),
    Identity("i65-member-b", "i65-member-b", "I65 Member B", ("Member",), "P4", "P5"),
    Identity("i65-member-c", "i65-member-c", "I65 Member C", ("Member",), "P4", "P6"),
    Identity("i65-member-d", "i65-member-d", "I65 Member D", ("Member",), "P5", "P6"),
    # Dimension 5: target level missing (NULL target_level).
    Identity("i65-member-e", "i65-member-e", "I65 Member E", ("Member",), "P4", None),
    # Dimension 6: reversed levels (current > target); the user row itself is
    # legal, but assessment scope must reject it.
    Identity("i65-member-f", "i65-member-f", "I65 Member F", ("Member",), "P6", "P4"),
    Identity("i65-buddy-a", "i65-buddy-a", "I65 Buddy A", ("Buddy",), None, None),
    Identity("i65-buddy-b", "i65-buddy-b", "I65 Buddy B", ("Buddy",), None, None),
    Identity("i65-leader", "i65-leader", "I65 Leader", ("Leader",), None, None),
    Identity("i65-admin", "i65-admin", "I65 Admin", ("Admin",), None, None),
)

# Single-team MVP: buddy_relationship is a guidance/review assignment,
# not team membership. Members e/f stay unassigned to cover the
# no-current-assignment boundary.
_BUDDY_ASSIGNMENTS: tuple[BuddyAssignment, ...] = (
    BuddyAssignment("i65-assign-a1", "i65-member-a", "i65-buddy-a"),
    BuddyAssignment("i65-assign-b1", "i65-member-b", "i65-buddy-a"),
    BuddyAssignment("i65-assign-c1", "i65-member-c", "i65-buddy-b"),
    BuddyAssignment("i65-assign-d1", "i65-member-d", "i65-buddy-b"),
)

_DIMENSIONS: tuple[Dimension, ...] = (
    Dimension(1, "transition-p4-p4", "P4→P4 职级组合"),
    Dimension(2, "transition-p4-p5", "P4→P5 职级组合"),
    Dimension(3, "transition-p4-p6", "P4→P6 职级组合"),
    Dimension(4, "transition-p5-p6", "P5→P6 职级组合"),
    Dimension(5, "missing-target-level", "目标职级缺失"),
    Dimension(6, "invalid-or-reversed-levels", "当前/目标职级非法或倒退"),
    Dimension(7, "l3-target-kinds", "显式标准目标/默认目标/不适用 L3"),
    Dimension(8, "assessment-lifecycle", "旧草稿/建议调整/已提交/已复核/已归档"),
    Dimension(9, "gap-counts", "无 Gap/单项 Gap/多项 Gap"),
    Dimension(10, "priorities", "高/中/低/暂缓"),
    Dimension(11, "plan-inclusion", "纳入计划与不纳入计划"),
    Dimension(12, "quarter-month", "Q1–Q4 和第 1–12 月"),
    Dimension(13, "personal-adjustment", "个人目标调整"),
    Dimension(14, "review-outcomes", "Review 认可和建议调整"),
    Dimension(15, "plan-task-lifecycle", "计划生成/重复生成/执行/延期/暂停/取消/完成"),
    Dimension(16, "logs-evidence", "多条日志/多条证据/通过/要求补充"),
    Dimension(17, "role-boundaries", "Member/Buddy/Leader/Admin 权限边界"),
    Dimension(18, "concurrency-idempotency", "并发保存/提交/Review/发布/计划生成"),
)


def _build_cases() -> tuple[Case, ...]:
    cases: list[Case] = [
        # Dimensions 1–4: the four level transitions.
        _case(
            "DM01-TRANS-P4-P4",
            1,
            "transition-p4-p4",
            "P4→P4 同级组合全链路数据",
            member_key="i65-member-a",
            current_level="P4",
            target_level="P4",
        ),
        _case(
            "DM02-TRANS-P4-P5",
            2,
            "transition-p4-p5",
            "P4→P5 晋升组合全链路数据",
            member_key="i65-member-b",
            current_level="P4",
            target_level="P5",
        ),
        _case(
            "DM03-TRANS-P4-P6",
            3,
            "transition-p4-p6",
            "P4→P6 跨级组合全链路数据",
            member_key="i65-member-c",
            current_level="P4",
            target_level="P6",
        ),
        _case(
            "DM04-TRANS-P5-P6",
            4,
            "transition-p5-p6",
            "P5→P6 晋升组合全链路数据",
            member_key="i65-member-d",
            current_level="P5",
            target_level="P6",
        ),
        # Dimension 5: missing target level.
        _case(
            "DM05-MISSING-TARGET",
            5,
            "missing-target-level",
            "目标职级缺失：Assessment 范围预览必须拒绝并提示",
            member_key="i65-member-e",
            current_level="P4",
            target_level=None,
            expected="scope-rejection",
        ),
        # Dimension 6: invalid / reversed levels.
        _case(
            "DM06-REVERSED-LEVELS",
            6,
            "reversed-levels",
            "倒退组合 P6→P4：用户行合法，Assessment 范围必须拒绝",
            member_key="i65-member-f",
            current_level="P6",
            target_level="P4",
            level_semantics="reversed",
            expected="scope-rejection",
        ),
        _case(
            "DM06-INVALID-LEVEL",
            6,
            "invalid-level",
            "非法职级值（P4–P8 之外）：仓储层校验必须拒绝",
            member_key="i65-member-a",
            current_level="P9",
            target_level="P5",
            level_semantics="invalid",
            expected="repository-rejection",
            descriptor_only="true",
        ),
        # Dimension 7: L3 target kinds.
        _case(
            "DM07-EXPLICIT-TARGET",
            7,
            "explicit-standard-target",
            "显式标准目标 L3",
            l3_target_kind="explicit",
            member_key="i65-member-b",
        ),
        _case(
            "DM07-DEFAULT-TARGET",
            7,
            "default-target",
            "默认目标 L3",
            l3_target_kind="default",
            member_key="i65-member-b",
        ),
        _case(
            "DM07-NOT-APPLICABLE-L3",
            7,
            "not-applicable-l3",
            "不适用的 L3",
            l3_target_kind="not-applicable",
            member_key="i65-member-c",
        ),
        # Dimension 8: assessment/review lifecycle states.
        _case(
            "DM08-OLD-DRAFT",
            8,
            "old-draft",
            "旧草稿",
            state="draft",
            member_key="i65-member-a",
        ),
        _case(
            "DM08-ADJUSTMENT-SUGGESTED",
            8,
            "adjustment-suggested",
            "建议调整",
            state="adjustment-suggested",
            member_key="i65-member-b",
        ),
        _case(
            "DM08-SUBMITTED",
            8,
            "submitted",
            "已提交",
            state="submitted",
            member_key="i65-member-c",
        ),
        _case(
            "DM08-REVIEWED",
            8,
            "reviewed",
            "已复核",
            state="reviewed",
            member_key="i65-member-d",
        ),
        _case(
            "DM08-ARCHIVED",
            8,
            "archived",
            "已归档",
            state="archived",
            member_key="i65-member-a",
        ),
        # Dimension 9: gap counts.
        _case(
            "DM09-NO-GAP",
            9,
            "no-gap",
            "无 Gap",
            gap_count="0",
            member_key="i65-member-a",
        ),
        _case(
            "DM09-SINGLE-GAP",
            9,
            "single-gap",
            "单项 Gap",
            gap_count="1",
            member_key="i65-member-b",
        ),
        _case(
            "DM09-MULTI-GAP",
            9,
            "multi-gap",
            "多项 Gap",
            gap_count="3",
            member_key="i65-member-c",
        ),
        # Dimension 10: priorities.
        *(
            _case(
                f"DM10-PRIORITY-{key}",
                10,
                f"priority-{key}",
                f"优先级{label}",
                priority=label,
                member_key="i65-member-b",
            )
            for key, label in zip(
                ("HIGH", "MEDIUM", "LOW", "DEFERRED"),
                PRIORITY_LABELS,
                strict=True,
            )
        ),
        # Dimension 11: plan inclusion choices.
        _case(
            "DM11-INCLUDED",
            11,
            "included-in-plan",
            "纳入计划",
            include_in_plan="true",
            member_key="i65-member-b",
        ),
        _case(
            "DM11-NOT-INCLUDED",
            11,
            "not-included-in-plan",
            "不纳入计划",
            include_in_plan="false",
            member_key="i65-member-b",
        ),
        # Dimension 12: quarter/month coverage.
        *(
            _case(
                f"DM12-{quarter}",
                12,
                f"quarter-{quarter.lower()}",
                f"{quarter} 季度与月份归属",
                quarter=quarter,
                months=",".join(str((q - 1) * 3 + i) for i in (1, 2, 3)),
                member_key="i65-member-b",
            )
            for q, quarter in enumerate(("Q1", "Q2", "Q3", "Q4"), start=1)
        ),
        # Dimension 13: personal goal adjustment.
        _case(
            "DM13-PERSONAL-ADJUSTMENT",
            13,
            "personal-target-adjustment",
            "个人目标调整留痕可追溯",
            member_key="i65-member-b",
            adjustment="target-level",
            expected="audited",
        ),
        # Dimension 14: review outcomes.
        _case(
            "DM14-REVIEW-APPROVED",
            14,
            "review-approved",
            "Review 认可",
            conclusion="认可",
            member_key="i65-member-b",
            buddy_key="i65-buddy-a",
        ),
        _case(
            "DM14-REVIEW-ADJUSTMENT",
            14,
            "review-adjustment",
            "Review 建议调整",
            conclusion="建议调整",
            member_key="i65-member-c",
            buddy_key="i65-buddy-b",
        ),
        # Dimension 15: plan/task lifecycle.
        _case(
            "DM15-PLAN-GENERATED",
            15,
            "plan-generated",
            "认可后生成计划",
            state="generated",
            member_key="i65-member-b",
        ),
        _case(
            "DM15-DUPLICATE-GENERATION",
            15,
            "duplicate-generation",
            "重复调用计划生成不产生重复项",
            state="generated",
            idempotent="true",
            member_key="i65-member-b",
        ),
        _case(
            "DM15-TASK-EXECUTING",
            15,
            "task-executing",
            "任务执行中",
            state="executing",
            member_key="i65-member-b",
        ),
        _case(
            "DM15-TASK-DELAYED",
            15,
            "task-delayed",
            "任务延期",
            state="delayed",
            member_key="i65-member-c",
        ),
        _case(
            "DM15-TASK-PAUSED",
            15,
            "task-paused",
            "任务暂停",
            state="paused",
            member_key="i65-member-c",
        ),
        _case(
            "DM15-TASK-CANCELLED",
            15,
            "task-cancelled",
            "任务取消",
            state="cancelled",
            member_key="i65-member-d",
        ),
        _case(
            "DM15-TASK-COMPLETED",
            15,
            "task-completed",
            "任务完成",
            state="completed",
            member_key="i65-member-d",
        ),
        # Dimension 16: logs and evidence.
        _case(
            "DM16-MULTI-LOGS",
            16,
            "multiple-logs",
            "多条日志累计耗时",
            log_count="3",
            member_key="i65-member-b",
        ),
        _case(
            "DM16-MULTI-EVIDENCE",
            16,
            "multiple-evidence",
            "多条证据版本",
            evidence_count="2",
            member_key="i65-member-b",
        ),
        _case(
            "DM16-EVIDENCE-APPROVED",
            16,
            "evidence-approved",
            "证据通过",
            review_result="通过",
            member_key="i65-member-b",
            buddy_key="i65-buddy-a",
        ),
        _case(
            "DM16-EVIDENCE-NEEDS-MORE",
            16,
            "evidence-needs-more",
            "证据要求补充",
            review_result="要求补充",
            member_key="i65-member-c",
            buddy_key="i65-buddy-b",
        ),
        # Dimension 17: role boundaries (single-team MVP).
        _case(
            "DM17-MEMBER-SELF",
            17,
            "member-self-scope",
            "Member 仅见本人数据",
            identity_key="i65-member-a",
            scope="self",
            expected="allowed-own-only",
        ),
        _case(
            "DM17-BUDDY-ASSIGNED",
            17,
            "buddy-assigned-scope",
            "Buddy 仅见当前被指派的 Member",
            identity_key="i65-buddy-a",
            assignment_key="i65-assign-a1",
            scope="assigned-members",
            expected="allowed-assigned-only",
        ),
        _case(
            "DM17-BUDDY-UNASSIGNED-DENIED",
            17,
            "buddy-unassigned-denied",
            "Buddy 访问未指派 Member 被拒",
            identity_key="i65-buddy-b",
            target_member_key="i65-member-a",
            expected="denied",
            buddy_relationship_semantics="assignment-not-membership",
        ),
        _case(
            "DM17-LEADER-ALL-MEMBERS",
            17,
            "leader-all-members",
            "Leader 可见单团队全部 Member",
            identity_key="i65-leader",
            scope="single-team-all-members",
            expected="allowed",
        ),
        _case(
            "DM17-ADMIN-LEADER-READ-SCOPE",
            17,
            "admin-leader-read-scope",
            "Admin 与 Leader 相同的单团队只读范围",
            identity_key="i65-admin",
            read_scope="same-as-leader",
            expected="read-only",
        ),
        # Dimension 18: concurrency / idempotency descriptors (not executed here).
        _case(
            "DM18-CONCURRENT-SAVE",
            18,
            "concurrent-save",
            "并发保存草稿：后提交端 409、输入保留、可安全重试",
            operation="save-draft",
            actor_a="i65-member-b",
            actor_b="i65-member-b",
            descriptor_only="true",
            expected="one-wins-409-other",
        ),
        _case(
            "DM18-CONCURRENT-SUBMIT",
            18,
            "concurrent-submit",
            "并发提交 Assessment",
            operation="submit-assessment",
            actor_a="i65-member-b",
            actor_b="i65-member-b",
            descriptor_only="true",
            expected="single-submission",
        ),
        _case(
            "DM18-CONCURRENT-REVIEW",
            18,
            "concurrent-review",
            "并发 Review 提交",
            operation="submit-review",
            actor_a="i65-buddy-a",
            actor_b="i65-buddy-b",
            descriptor_only="true",
            expected="single-effective-review",
        ),
        _case(
            "DM18-CONCURRENT-PUBLISH",
            18,
            "concurrent-publish",
            "并发发布能力标准新版本",
            operation="publish-standard",
            actor_a="i65-leader",
            actor_b="i65-admin",
            descriptor_only="true",
            expected="single-version",
        ),
        _case(
            "DM18-CONCURRENT-PLAN-GEN",
            18,
            "concurrent-plan-generation",
            "并发计划生成",
            operation="generate-plan",
            actor_a="i65-buddy-a",
            actor_b="i65-buddy-a",
            descriptor_only="true",
            expected="no-duplicate-items",
        ),
        _case(
            "DM18-IDEMPOTENT-REPLAY",
            18,
            "idempotent-replay",
            "幂等键重放不重复写入",
            operation="replay-with-idempotency-key",
            actor_a="i65-member-b",
            actor_b="i65-member-b",
            descriptor_only="true",
            idempotency_key_strategy="stable-key",
            expected="no-duplicate-write",
        ),
    ]
    return tuple(cases)


def build_catalog() -> Catalog:
    """Pure deterministic construction; identical result on every call."""
    return Catalog(
        identities=_IDENTITIES,
        buddy_assignments=_BUDDY_ASSIGNMENTS,
        dimensions=_DIMENSIONS,
        cases=_build_cases(),
    )


def iter_violations(catalog: Catalog) -> list[str]:
    """Cross-field invariant check; an executable catalog has no violations."""
    violations: list[str] = []
    by_key = {identity.key: identity for identity in catalog.identities}
    if len(by_key) != len(catalog.identities):
        violations.append("duplicate identity key")
    usernames = [identity.username for identity in catalog.identities]
    if len(set(usernames)) != len(usernames):
        violations.append("duplicate identity username")
    case_ids = [case.case_id for case in catalog.cases]
    if len(set(case_ids)) != len(case_ids):
        violations.append("duplicate case_id")
    dimension_numbers = [dimension.number for dimension in catalog.dimensions]
    if dimension_numbers != list(range(1, 19)):
        violations.append("dimensions must be numbered 1..18 contiguously")
    covered = {case.dimension for case in catalog.cases}
    for number in dimension_numbers:
        if number not in covered:
            violations.append(f"dimension {number} has no case")
    for case in catalog.cases:
        if case.dimension not in dimension_numbers:
            violations.append(f"{case.case_id}: unknown dimension {case.dimension}")
        attrs = dict(case.attributes)
        for ref_key in ("member_key", "buddy_key", "identity_key", "target_member_key"):
            ref = attrs.get(ref_key)
            if ref is not None and str(ref) not in by_key:
                violations.append(f"{case.case_id}: unknown {ref_key} {ref!r}")
        for level_field in ("current_level", "target_level"):
            value = attrs.get(level_field)
            if (
                value is not None
                and attrs.get("level_semantics") != "invalid"
                and value not in VALID_LEVELS
            ):
                violations.append(f"{case.case_id}: bad {level_field} {value!r}")
        if case.dimension in (1, 2, 3, 4):
            current = str(attrs["current_level"])
            target = str(attrs["target_level"])
            if int(current[1:]) > int(target[1:]):
                violations.append(f"{case.case_id}: reversed transition")
        if case.dimension == 10 and attrs.get("priority") not in PRIORITY_LABELS:
            violations.append(f"{case.case_id}: bad priority {attrs.get('priority')!r}")
        if case.dimension == 12:
            quarter = int(str(attrs["quarter"])[1])
            months = {int(m) for m in str(attrs["months"]).split(",")}
            if months != {(quarter - 1) * 3 + i for i in (1, 2, 3)}:
                violations.append(f"{case.case_id}: quarter/month mismatch")
    for assignment in catalog.buddy_assignments:
        member = by_key.get(assignment.member_key)
        buddy = by_key.get(assignment.buddy_key)
        if member is None or "Member" not in member.roles:
            violations.append(f"{assignment.key}: member must have Member role")
        if buddy is None or "Buddy" not in buddy.roles:
            violations.append(f"{assignment.key}: buddy must have Buddy role")
    return violations


def materialize_identities(
    connection: psycopg.Connection, catalog: Catalog
) -> dict[str, int]:
    """Insert the synthetic identities and Buddy assignments; key → user id.

    Reuses app.access.repository seams and the review_support UPDATE pattern.
    Callers own schema setup (e.g. tests.review_support.reset_full_schema).
    """
    ids: dict[str, int] = {}
    for identity in catalog.identities:
        user_id = create_user(
            connection, identity.username, identity.full_name, _TEST_PASSWORD
        )
        for role in identity.roles:
            assign_role(connection, user_id, role)
        connection.execute(
            "UPDATE tcp_user SET current_level=%s, target_level=%s WHERE id=%s",
            (identity.current_level, identity.target_level, user_id),
        )
        ids[identity.key] = user_id
    for assignment in catalog.buddy_assignments:
        create_buddy_relationship(
            connection, ids[assignment.member_key], ids[assignment.buddy_key]
        )
    connection.commit()
    return ids
