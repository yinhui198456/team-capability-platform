"""v0015: plan_month INT → TEXT 'YYYY-MM' contract upgrade (Issue #194).

plan_month 的 canonical 值升级为 TEXT 'YYYY-MM'（docs/01_Product.md
§"Issue #187 故事合同"：单一 YYYY-MM 月份输入）。plan_quarter 保留为兼容列，
只能由 plan_month 推导（一致性约束保护），不再接受前端输入。三张表同步升级：
assessment_detail / plan_item / annual_plan_change_proposal_detail。

转换规则（总控纠正三）：
- 旧 INT 仅用所属 assessment / annual_growth_plan / annual_plan_change_proposal
  的明确 year 确定性转换（PostgreSQL 官方 ALTER COLUMN TYPE ... USING 显式转换）；
- NULL 保持 NULL；
- 属主缺失（孤儿行）→ 预校验 loud fail，绝不伪造。

约束替换：
- 删除：plan_month INT 范围 CHECK、quarter-month 配对 CHECK（INT 算术）、
  plan_time_required（include_in_plan=TRUE 且 plan_month 为 NULL =
  待补计划月份，契约允许）；
- 新增：plan_month 格式 CHECK（^[0-9]{4}-(0[1-9]|1[0-2])$）、
  plan_quarter 一致性 CHECK（plan_month 非空时 plan_quarter 必须等于派生季度）；
- 保留：plan_quarter 值域 CHECK、include_in_plan=FALSE/NULL ⇒ 时间字段为 NULL、
  暂缓互斥等与类型无关的约束。

不删除 plan_quarter 列、不回填历史业务对象。

注：app/{assessment,planning}/schema.py 保持 v0007 基线（INT）不变 —
v0010 等历史迁移对 plan_month 做 INT 数值运算（MAKE_DATE 等），v0015 是
TEXT 升级的唯一权威，schema 文件的基线形态由本迁移升级到目标态。
"""

import psycopg

_PLAN_MONTH_FORMAT = "plan_month IS NULL OR plan_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'"

_QUARTER_MATCHES = """
    plan_quarter IS NULL OR plan_month IS NULL OR plan_quarter = CASE
        WHEN substr(plan_month, 6, 2) IN ('01', '02', '03') THEN 'Q1'
        WHEN substr(plan_month, 6, 2) IN ('04', '05', '06') THEN 'Q2'
        WHEN substr(plan_month, 6, 2) IN ('07', '08', '09') THEN 'Q3'
        ELSE 'Q4'
    END
"""

# table → (owner alias, owner table spec, join predicate, year expression)
# for the deterministic conversion; owner.year is NOT NULL on all three.
_TABLE_OWNERS = {
    "assessment_detail": (
        "a",
        "assessment a",
        "a.id = assessment_detail.assessment_id",
    ),
    "plan_item": (
        "agp",
        "annual_growth_plan agp",
        "agp.id = plan_item.annual_growth_plan_id",
    ),
    "annual_plan_change_proposal_detail": (
        "p",
        "annual_plan_change_proposal p",
        "p.id = annual_plan_change_proposal_detail.proposal_id",
    ),
}


def _constraints_referencing_int_plan_month(
    connection: psycopg.Connection, table: str
) -> list[str]:
    """Names of CHECK constraints on ``table`` that encode the old INT
    plan_month semantics (range / quarter pairing / plan_time_required).

    pg_get_constraintdef normalizes BETWEEN to >=/<=, so the drop set is
    matched on two precise patterns: numeric comparisons on plan_month
    (range + pair mapping), and the plan_time_required shape
    (include_in_plan IS DISTINCT FROM true → both fields set).  The
    approval-completeness checks share the ``plan_month IS NOT NULL``
    text but key on ``include_in_plan IS TRUE`` and must survive (plan
    items / proposal snapshots are only written at generation time, when
    a valid YYYY-MM month is always required).  Both the named v0007-era
    constraints and the inline auto-named ones are dropped.
    """
    rows = connection.execute(
        """
        SELECT conname FROM pg_constraint
        WHERE conrelid = %s::regclass
          AND (
              -- INT range / quarter-pairing checks (BETWEEN normalizes to >= <=)
              (pg_get_constraintdef(oid) LIKE '%%plan_month >=%%'
               OR pg_get_constraintdef(oid) LIKE '%%plan_month <=%%')
              -- plan_time_required (include_in_plan=TRUE → both set) and its
              -- inline duplicate; approval-completeness shares the IS NOT NULL
              -- text but keys on include_in_plan IS TRUE and must survive.
              OR (pg_get_constraintdef(oid)
                      LIKE '%%include_in_plan IS DISTINCT FROM true%%'
                  AND pg_get_constraintdef(oid) LIKE '%%plan_month%%')
          )
        """,
        (table,),
    ).fetchall()
    return [r[0] for r in rows]


def _constraint_exists(connection: psycopg.Connection, table: str, name: str) -> bool:
    row = connection.execute(
        "SELECT 1 FROM pg_constraint " "WHERE conrelid = %s::regclass AND conname = %s",
        (table, name),
    ).fetchone()
    return row is not None


def _upgrade_table(connection: psycopg.Connection, table: str) -> None:
    owner_alias, owner_spec, owner_join = _TABLE_OWNERS[table]

    # 1. Pre-validation: a set plan_month must have a determinable owner year.
    #    Orphan rows → loud fail, never fabricate a year.
    orphan = connection.execute(
        f"""
        SELECT COUNT(*) FROM {table}
        LEFT JOIN {owner_spec} ON {owner_join}
        WHERE plan_month IS NOT NULL AND {owner_alias}.id IS NULL
        """,
    ).fetchone()[0]
    if orphan > 0:
        raise RuntimeError(
            f"v0015: {orphan} row(s) on {table} have plan_month set but no "
            f"determinable owner year; refusing to fabricate"
        )

    # 2. Drop old INT-semantics CHECK constraints (definition-matched).
    for name in _constraints_referencing_int_plan_month(connection, table):
        connection.execute(f"ALTER TABLE {table} DROP CONSTRAINT {name}")

    # 3. ALTER COLUMN TYPE ... USING — PostgreSQL official explicit conversion
    #    (same-row cast only; subqueries are rejected inside USING). The year
    #    join happens right after in a plain UPDATE, which may use joins.
    connection.execute(
        f"""
        ALTER TABLE {table} ALTER COLUMN plan_month TYPE TEXT
        USING (plan_month::text)
        """
    )
    connection.execute(
        f"""
        UPDATE {table}
        SET plan_month =
            to_char({owner_alias}.year, 'FM0000')
            || '-' || lpad(plan_month, 2, '0')
        FROM {owner_spec}
        WHERE {owner_join} AND plan_month IS NOT NULL
        """
    )

    # 4. New named constraints (format + derived-quarter consistency).
    format_name = f"{table}_plan_month_format"
    quarter_name = f"{table}_plan_quarter_matches_month"
    if not _constraint_exists(connection, table, format_name):
        connection.execute(
            f"ALTER TABLE {table} ADD CONSTRAINT {format_name} "
            f"CHECK ({_PLAN_MONTH_FORMAT})"
        )
    if not _constraint_exists(connection, table, quarter_name):
        connection.execute(
            f"ALTER TABLE {table} ADD CONSTRAINT {quarter_name} "
            f"CHECK ({_QUARTER_MATCHES})"
        )

    # 5. Belt & braces: every non-NULL plan_month must match YYYY-MM.
    bad = connection.execute(
        f"""
        SELECT COUNT(*) FROM {table}
        WHERE plan_month IS NOT NULL
          AND plan_month !~ '^[0-9]{{4}}-(0[1-9]|1[0-2])$'
        """,
    ).fetchone()[0]
    if bad > 0:
        raise RuntimeError(
            f"v0015: {bad} row(s) on {table} converted to a non-YYYY-MM value"
        )


def upgrade(connection: psycopg.Connection) -> None:
    for table in _TABLE_OWNERS:
        _upgrade_table(connection, table)
