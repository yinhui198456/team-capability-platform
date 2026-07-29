from concurrent.futures import ThreadPoolExecutor

import psycopg
import pytest

from app.access.repository import create_user
from app.access.schema import create_access_schema
from app.assessment.repository import (
    DraftTargetRepairError,
    get_draft_target_repair_preview,
    repair_draft_target_snapshots,
)
from app.assessment.schema import create_assessment_schema
from app.catalog.schema import create_catalog_schema
from app.migrations import run_migrations
from app.migrations.versions.v0004_legacy_draft_target_repair import upgrade


def _schema(
    connection: psycopg.Connection, *, second_l3_start_level: str = "P4"
) -> tuple[int, int]:
    with connection.transaction():
        for table in (
            "schema_migration",
            "snapshot_check_name_collision",
            "assessment_draft_target_repair_audit",
            "assessment_review",
            "gap",
            "assessment_detail",
            "assessment",
            "capability_standard_item",
            "capability_standard_version",
            "capability_standard_target_override",
            "capability_node",
            "capability_model",
            "tcp_session",
            "tcp_user_role",
            "tcp_role",
            "tcp_user",
        ):
            connection.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
    create_access_schema(connection)
    create_catalog_schema(connection)
    create_assessment_schema(connection)

    model_id = connection.execute(
        """
        INSERT INTO capability_model
            (code, name, version, source_workbook, source_sheet, source_row)
        VALUES ('repair-model', 'Repair model', '1', 'test.xlsx', 'model', 1)
        RETURNING id
        """
    ).fetchone()[0]
    l1_id = connection.execute(
        """
        INSERT INTO capability_node
            (model_id, node_type, code, name, sort_order,
             source_workbook, source_sheet, source_row)
        VALUES (%s, 'L1', 'P01', 'Domain', 1, 'test.xlsx', 'model', 2)
        RETURNING id
        """,
        (model_id,),
    ).fetchone()[0]
    l2_id = connection.execute(
        """
        INSERT INTO capability_node
            (model_id, parent_node_id, node_type, code, name, sort_order,
             source_workbook, source_sheet, source_row)
        VALUES (%s, %s, 'L2', 'P01.01', 'Area', 1, 'test.xlsx', 'model', 3)
        RETURNING id
        """,
        (model_id, l1_id),
    ).fetchone()[0]
    for order, code in enumerate(("P01.01.01", "P01.01.02"), 1):
        connection.execute(
            """
            INSERT INTO capability_node
                (model_id, parent_node_id, node_type, code, name, sort_order,
                 recommended_start_level, source_workbook, source_sheet, source_row)
            VALUES (%s, %s, 'L3', %s, %s, %s, %s, 'test.xlsx', 'model', %s)
            """,
            (
                model_id,
                l2_id,
                code,
                code,
                order,
                "P4" if order == 1 else second_l3_start_level,
                order + 3,
            ),
        )
    member_id = create_user(connection, "repair-member", "Repair Member", "secret")
    connection.execute(
        "UPDATE tcp_user SET current_level = 'P4', target_level = 'P5' WHERE id = %s",
        (member_id,),
    )
    connection.commit()
    run_migrations(connection)
    connection.commit()
    return int(member_id), int(model_id)


def _assessment(
    connection: psycopg.Connection, member_id: int, status: str = "草稿"
) -> int:
    return int(
        connection.execute(
            """
            INSERT INTO assessment (member_id, year, version, assessment_type, status)
            VALUES (%s, 2026, 1, '年度', %s)
            RETURNING id
            """,
            (member_id, status),
        ).fetchone()[0]
    )


def _legacy_detail(
    connection: psycopg.Connection, assessment_id: int, code: str
) -> None:
    connection.execute(
        """
        INSERT INTO assessment_detail (
            assessment_id, l3_code, current_level, target_level, gap_value,
            standard_target_applicable, standard_target_level,
            target_snapshot_source, target_compatibility_error, evidence_note
        ) VALUES (%s, %s, 1, 3, 2, NULL, NULL, 'legacy_preserved',
                  '历史明细缺少目标快照', '保留的历史文本')
        """,
        (assessment_id, code),
    )


def _repair_state(
    connection: psycopg.Connection, assessment_id: int
) -> tuple[object, ...]:
    return (
        connection.execute(
            """
            SELECT revision, member_current_level_snapshot,
                   member_target_level_snapshot, capability_standard_version_id
            FROM assessment WHERE id = %s
            """,
            (assessment_id,),
        ).fetchall(),
        connection.execute(
            """
            SELECT l3_code, current_level, target_level, gap_value,
                   target_compatibility_error
            FROM assessment_detail WHERE assessment_id = %s ORDER BY l3_code
            """,
            (assessment_id,),
        ).fetchall(),
        connection.execute(
            """
            SELECT l3_code, current_level, target_level, gap_value, plan_candidate
            FROM gap WHERE assessment_id = %s ORDER BY l3_code
            """,
            (assessment_id,),
        ).fetchall(),
        connection.execute(
            """
            SELECT count(*) FROM assessment_draft_target_repair_audit
            WHERE assessment_id = %s
            """,
            (assessment_id,),
        ).fetchone(),
    )


def _add_l3_model(connection: psycopg.Connection, code: str, model_code: str) -> int:
    model_id = connection.execute(
        """
        INSERT INTO capability_model
            (code, name, version, source_workbook, source_sheet, source_row)
        VALUES (%s, %s, '1', 'test.xlsx', 'model', 20)
        RETURNING id
        """,
        (model_code, model_code),
    ).fetchone()[0]
    l1_id = connection.execute(
        """
        INSERT INTO capability_node
            (model_id, node_type, code, name, sort_order,
             source_workbook, source_sheet, source_row)
        VALUES (%s, 'L1', 'P02', 'Domain', 1, 'test.xlsx', 'model', 21)
        RETURNING id
        """,
        (model_id,),
    ).fetchone()[0]
    l2_id = connection.execute(
        """
        INSERT INTO capability_node
            (model_id, parent_node_id, node_type, code, name, sort_order,
             source_workbook, source_sheet, source_row)
        VALUES (%s, %s, 'L2', 'P02.01', 'Area', 1, 'test.xlsx', 'model', 22)
        RETURNING id
        """,
        (model_id, l1_id),
    ).fetchone()[0]
    connection.execute(
        """
        INSERT INTO capability_node
            (model_id, parent_node_id, node_type, code, name, sort_order,
             recommended_start_level, source_workbook, source_sheet, source_row)
        VALUES (%s, %s, 'L3', %s, %s, 1, 'P4', 'test.xlsx', 'model', 23)
        """,
        (model_id, l2_id, code, code),
    )
    return int(model_id)


def test_migration_publishes_a_complete_legacy_baseline_once(
    connection: psycopg.Connection,
) -> None:
    _, model_id = _schema(connection)

    version = connection.execute(
        """
        SELECT model_id, version_no, status, created_by, published_by
        FROM capability_standard_version
        """
    ).fetchone()
    assert version == (model_id, 1, "已发布", None, None)
    assert (
        connection.execute("SELECT count(*) FROM capability_standard_item").fetchone()[
            0
        ]
        == 10
    )
    run_migrations(connection)
    assert (
        connection.execute(
            "SELECT count(*) FROM capability_standard_version"
        ).fetchone()[0]
        == 1
    )


def test_repair_uses_only_the_assessments_capability_model_baseline(
    connection: psycopg.Connection,
) -> None:
    member_id, model_a = _schema(connection)
    model_b = _add_l3_model(connection, "P02.01.01", "repair-model-b")
    upgrade(connection)
    assessment_id = _assessment(connection, member_id)
    _legacy_detail(connection, assessment_id, "P01.01.01")
    connection.commit()

    preview = get_draft_target_repair_preview(connection, assessment_id)
    assert preview["summary"]["unrepairable_count"] == 0
    baseline = connection.execute(
        "SELECT model_id FROM capability_standard_version WHERE id = %s",
        (preview["standard_version"]["id"],),
    ).fetchone()[0]
    assert baseline == model_a
    assert (
        connection.execute(
            "SELECT count(*) FROM capability_standard_version WHERE model_id = %s",
            (model_b,),
        ).fetchone()[0]
        == 1
    )


def test_cross_model_or_ambiguous_details_block_all_writes(
    connection: psycopg.Connection,
) -> None:
    member_id, _ = _schema(connection)
    _add_l3_model(connection, "P02.01.01", "repair-model-b")
    upgrade(connection)
    assessment_id = _assessment(connection, member_id)
    _legacy_detail(connection, assessment_id, "P01.01.01")
    _legacy_detail(connection, assessment_id, "P02.01.01")
    connection.commit()
    before = _repair_state(connection, assessment_id)

    preview = get_draft_target_repair_preview(connection, assessment_id)
    assert preview["summary"]["unrepairable_count"] == 2
    with pytest.raises(DraftTargetRepairError, match="unrepairable"):
        repair_draft_target_snapshots(
            connection, assessment_id, member_id, expected_revision=1
        )
    assert _repair_state(connection, assessment_id) == before


def test_ambiguous_l3_identity_across_models_blocks_all_writes(
    connection: psycopg.Connection,
) -> None:
    member_id, _ = _schema(connection)
    _add_l3_model(connection, "P01.01.01", "repair-model-b")
    upgrade(connection)
    assessment_id = _assessment(connection, member_id)
    _legacy_detail(connection, assessment_id, "P01.01.01")
    connection.commit()
    before = connection.execute(
        """
        SELECT a.revision, ad.target_level, g.id,
               (SELECT count(*) FROM assessment_draft_target_repair_audit)
        FROM assessment a
        JOIN assessment_detail ad ON ad.assessment_id = a.id
        LEFT JOIN gap g ON g.assessment_id = a.id
        WHERE a.id = %s
        """,
        (assessment_id,),
    ).fetchall()

    preview = get_draft_target_repair_preview(connection, assessment_id)

    assert preview["summary"]["unrepairable_count"] == 1
    with pytest.raises(DraftTargetRepairError) as error:
        repair_draft_target_snapshots(
            connection, assessment_id, member_id, expected_revision=1
        )
    assert error.value.code == "draft_repair_has_unrepairable_details"
    assert (
        connection.execute(
            """
            SELECT a.revision, ad.target_level, g.id,
                   (SELECT count(*) FROM assessment_draft_target_repair_audit)
            FROM assessment a
            JOIN assessment_detail ad ON ad.assessment_id = a.id
            LEFT JOIN gap g ON g.assessment_id = a.id
            WHERE a.id = %s
            """,
            (assessment_id,),
        ).fetchall()
        == before
    )


def test_canonical_gap_for_not_applicable_detail_blocks_all_writes(
    connection: psycopg.Connection,
) -> None:
    member_id, _ = _schema(connection, second_l3_start_level="P6")
    assessment_id = _assessment(connection, member_id)
    _legacy_detail(connection, assessment_id, "P01.01.02")
    connection.execute(
        """
        INSERT INTO gap (
            assessment_id, l3_code, current_level, target_level, gap_value,
            plan_candidate
        ) VALUES (%s, 'P01-01-02', 1, 3, 2, FALSE)
        """,
        (assessment_id,),
    )
    connection.commit()
    before = connection.execute(
        """
        SELECT a.revision, ad.target_level, g.l3_code, g.gap_value,
               (SELECT count(*) FROM assessment_draft_target_repair_audit)
        FROM assessment a
        JOIN assessment_detail ad ON ad.assessment_id = a.id
        JOIN gap g ON g.assessment_id = a.id
        WHERE a.id = %s
        """,
        (assessment_id,),
    ).fetchall()

    preview = get_draft_target_repair_preview(connection, assessment_id)

    assert preview["summary"]["unrepairable_count"] == 1
    with pytest.raises(DraftTargetRepairError) as error:
        repair_draft_target_snapshots(
            connection, assessment_id, member_id, expected_revision=1
        )
    assert error.value.code == "draft_repair_has_unrepairable_details"
    assert (
        connection.execute(
            """
            SELECT a.revision, ad.target_level, g.l3_code, g.gap_value,
                   (SELECT count(*) FROM assessment_draft_target_repair_audit)
            FROM assessment a
            JOIN assessment_detail ad ON ad.assessment_id = a.id
            JOIN gap g ON g.assessment_id = a.id
            WHERE a.id = %s
            """,
            (assessment_id,),
        ).fetchall()
        == before
    )


@pytest.mark.parametrize(
    "detail_codes,gap_codes",
    (
        (("P01.01.01",), ("legacy-orphan",)),
        (("P01.01.01",), ("P01.01.01", "P01-01-01")),
        (("P01.01.01", "P01-01-01"), ("P01.01.01",)),
    ),
    ids=("orphan-gap", "duplicate-canonical-gap", "duplicate-canonical-detail"),
)
def test_non_bijective_detail_gap_identities_block_all_writes(
    connection: psycopg.Connection,
    detail_codes: tuple[str, ...],
    gap_codes: tuple[str, ...],
) -> None:
    member_id, _ = _schema(connection)
    assessment_id = _assessment(connection, member_id)
    for detail_code in detail_codes:
        _legacy_detail(connection, assessment_id, detail_code)
    for gap_code in gap_codes:
        connection.execute(
            """
            INSERT INTO gap (
                assessment_id, l3_code, current_level, target_level, gap_value,
                plan_candidate
            ) VALUES (%s, %s, 1, 3, 2, FALSE)
            """,
            (assessment_id, gap_code),
        )
    connection.commit()
    before = _repair_state(connection, assessment_id)

    preview = get_draft_target_repair_preview(connection, assessment_id)

    assert preview["summary"]["unrepairable_count"] == len(detail_codes)
    with pytest.raises(DraftTargetRepairError) as error:
        repair_draft_target_snapshots(
            connection, assessment_id, member_id, expected_revision=1
        )
    assert error.value.code == "draft_repair_has_unrepairable_details"
    assert _repair_state(connection, assessment_id) == before


def test_missing_model_baseline_blocks_all_writes(
    connection: psycopg.Connection,
) -> None:
    member_id, model_id = _schema(connection)
    connection.execute(
        """
        DELETE FROM capability_standard_item
        WHERE version_id IN (
            SELECT id FROM capability_standard_version WHERE model_id = %s
        )
        """,
        (model_id,),
    )
    connection.execute(
        "DELETE FROM capability_standard_version WHERE model_id = %s", (model_id,)
    )
    assessment_id = _assessment(connection, member_id)
    _legacy_detail(connection, assessment_id, "P01.01.01")
    connection.commit()
    before = _repair_state(connection, assessment_id)

    preview = get_draft_target_repair_preview(connection, assessment_id)

    assert preview["summary"]["unrepairable_count"] == 1
    with pytest.raises(DraftTargetRepairError) as error:
        repair_draft_target_snapshots(
            connection, assessment_id, member_id, expected_revision=1
        )
    assert error.value.code == "draft_repair_has_unrepairable_details"
    assert _repair_state(connection, assessment_id) == before


def test_repair_updates_a_canonical_gap_without_creating_a_dot_dash_duplicate(
    connection: psycopg.Connection,
) -> None:
    member_id, _ = _schema(connection)
    assessment_id = _assessment(connection, member_id)
    _legacy_detail(connection, assessment_id, "P01.01.01")
    connection.execute(
        """
        INSERT INTO gap (
            assessment_id, l3_code, current_level, target_level, gap_value,
            plan_candidate
        ) VALUES (%s, 'P01-01-01', 1, 3, 2, FALSE)
        """,
        (assessment_id,),
    )
    connection.commit()

    repair_draft_target_snapshots(
        connection, assessment_id, member_id, expected_revision=1
    )

    assert connection.execute(
        "SELECT l3_code, current_level, target_level, gap_value FROM gap "
        "WHERE assessment_id = %s",
        (assessment_id,),
    ).fetchall() == [("P01-01-01", 1, 3, 2)]


def test_upgrade_adds_snapshot_checks_to_assessment_not_another_table(
    connection: psycopg.Connection,
) -> None:
    member_id, _ = _schema(connection)
    check_names = (
        "assessment_member_current_level_snapshot_check",
        "assessment_member_target_level_snapshot_check",
    )
    for check_name in check_names:
        connection.execute(f"ALTER TABLE assessment DROP CONSTRAINT {check_name}")
    connection.execute(
        """
        CREATE TABLE snapshot_check_name_collision (
            value TEXT CONSTRAINT assessment_member_current_level_snapshot_check
            CHECK (value IS NULL)
        )
        """
    )
    connection.commit()

    upgrade(connection)
    assessment_constraints = {
        row[0]
        for row in connection.execute(
            """
            SELECT conname FROM pg_constraint
            WHERE conrelid = 'assessment'::regclass
            """
        ).fetchall()
    }

    assert set(check_names).issubset(assessment_constraints)
    assessment_id = _assessment(connection, member_id)
    connection.commit()
    with pytest.raises(psycopg.errors.CheckViolation):
        with connection.transaction():
            connection.execute(
                """
                UPDATE assessment SET member_current_level_snapshot = 'P9'
                WHERE id = %s
                """,
                (assessment_id,),
            )
    with pytest.raises(psycopg.errors.CheckViolation):
        with connection.transaction():
            connection.execute(
                """
                UPDATE assessment SET member_target_level_snapshot = ''
                WHERE id = %s
                """,
                (assessment_id,),
            )
    connection.execute(
        """
        UPDATE assessment
        SET member_current_level_snapshot = 'P4',
            member_target_level_snapshot = 'P8'
        WHERE id = %s
        """,
        (assessment_id,),
    )
    connection.execute(
        """
        UPDATE assessment
        SET member_current_level_snapshot = NULL,
            member_target_level_snapshot = NULL
        WHERE id = %s
        """,
        (assessment_id,),
    )


def test_upgrade_rolls_back_when_existing_snapshot_is_not_a_job_level(
    connection: psycopg.Connection,
) -> None:
    member_id, _ = _schema(connection)
    for check_name in (
        "assessment_member_current_level_snapshot_check",
        "assessment_member_target_level_snapshot_check",
    ):
        connection.execute(f"ALTER TABLE assessment DROP CONSTRAINT {check_name}")
    assessment_id = _assessment(connection, member_id)
    connection.execute(
        """
        UPDATE assessment SET member_current_level_snapshot = 'P9'
        WHERE id = %s
        """,
        (assessment_id,),
    )
    connection.execute(
        "DELETE FROM schema_migration WHERE version = '0004_legacy_draft_target_repair'"
    )
    connection.commit()

    with pytest.raises(psycopg.errors.CheckViolation):
        run_migrations(connection)

    assert (
        connection.execute(
            """
            SELECT count(*) FROM schema_migration
            WHERE version = '0004_legacy_draft_target_repair'
            """
        ).fetchone()[0]
        == 0
    )


def test_repair_rebuilds_every_detail_and_records_one_audit(
    connection: psycopg.Connection,
) -> None:
    member_id, _ = _schema(connection)
    assessment_id = _assessment(connection, member_id)
    _legacy_detail(connection, assessment_id, "P01.01.01")
    _legacy_detail(connection, assessment_id, "P01.01.02")
    connection.commit()

    preview = get_draft_target_repair_preview(connection, assessment_id)
    assert preview["summary"]["unrepairable_count"] == 0
    assert preview["summary"]["rebuild_count"] == 2

    result = repair_draft_target_snapshots(
        connection, assessment_id, member_id, expected_revision=1
    )
    assert result["result"] == "repaired"
    assert result["revision"] == 2
    assert result["audit_id"]
    assert (
        connection.execute(
            "SELECT count(*) FROM assessment_draft_target_repair_audit"
        ).fetchone()[0]
        == 1
    )
    assert (
        connection.execute(
            "SELECT count(*) FROM assessment_detail "
            "WHERE assessment_id = %s AND target_compatibility_error IS NOT NULL",
            (assessment_id,),
        ).fetchone()[0]
        == 0
    )


def test_unrepairable_detail_blocks_the_entire_assessment_with_zero_writes(
    connection: psycopg.Connection,
) -> None:
    member_id, _ = _schema(connection)
    assessment_id = _assessment(connection, member_id)
    _legacy_detail(connection, assessment_id, "P01.01.01")
    _legacy_detail(connection, assessment_id, "legacy-unknown")
    connection.commit()
    before = connection.execute(
        """
        SELECT a.revision, a.member_current_level_snapshot,
               ad.l3_code, ad.target_level, ad.target_compatibility_error
        FROM assessment a JOIN assessment_detail ad ON ad.assessment_id = a.id
        WHERE a.id = %s ORDER BY ad.l3_code
        """,
        (assessment_id,),
    ).fetchall()

    with pytest.raises(DraftTargetRepairError) as error:
        repair_draft_target_snapshots(
            connection, assessment_id, member_id, expected_revision=1
        )
    assert error.value.code == "draft_repair_has_unrepairable_details"
    assert (
        connection.execute(
            """
        SELECT a.revision, a.member_current_level_snapshot,
               ad.l3_code, ad.target_level, ad.target_compatibility_error
        FROM assessment a JOIN assessment_detail ad ON ad.assessment_id = a.id
        WHERE a.id = %s ORDER BY ad.l3_code
        """,
            (assessment_id,),
        ).fetchall()
        == before
    )
    assert (
        connection.execute(
            "SELECT count(*) FROM assessment_draft_target_repair_audit"
        ).fetchone()[0]
        == 0
    )


def test_missing_assessment_snapshot_is_repaired_then_a_true_noop_is_audit_free(
    connection: psycopg.Connection,
) -> None:
    member_id, _ = _schema(connection)
    assessment_id = _assessment(connection, member_id)
    _legacy_detail(connection, assessment_id, "P01.01.01")
    connection.commit()

    first = repair_draft_target_snapshots(
        connection, assessment_id, member_id, expected_revision=1
    )
    assert first["result"] == "repaired"
    assert first["revision"] == 2
    assert (
        connection.execute(
            "SELECT count(*) FROM assessment_draft_target_repair_audit"
        ).fetchone()[0]
        == 1
    )
    state_before_noop = _repair_state(connection, assessment_id)

    second = repair_draft_target_snapshots(
        connection, assessment_id, member_id, expected_revision=2
    )
    assert second == {
        "result": "noop",
        "assessment_id": assessment_id,
        "old_revision": 2,
        "revision": 2,
        "audit_id": None,
        "summary": second["summary"],
        "unrepairable_details": [],
    }
    assert second["summary"]["unrepairable_count"] == 0
    assert _repair_state(connection, assessment_id) == state_before_noop
    assert (
        connection.execute(
            "SELECT count(*) FROM assessment_draft_target_repair_audit"
        ).fetchone()[0]
        == 1
    )


def test_repair_preserves_each_valid_assessment_snapshot_independently(
    connection: psycopg.Connection,
) -> None:
    member_id, _ = _schema(connection)
    assessment_id = _assessment(connection, member_id)
    _legacy_detail(connection, assessment_id, "P01.01.01")
    connection.execute(
        """
        UPDATE assessment
        SET member_current_level_snapshot = 'P5',
            member_target_level_snapshot = NULL
        WHERE id = %s
        """,
        (assessment_id,),
    )
    connection.commit()

    preview = get_draft_target_repair_preview(connection, assessment_id)
    assert preview["member_current_level"] == {
        "value": "P5",
        "source": "assessment_snapshot",
    }
    assert preview["member_target_level"] == {
        "value": "P5",
        "source": "repair_time_user_profile",
    }
    repair_draft_target_snapshots(
        connection, assessment_id, member_id, expected_revision=1
    )
    assert (
        connection.execute(
            """
            SELECT member_current_level_snapshot, member_target_level_snapshot
            FROM assessment WHERE id = %s
            """,
            (assessment_id,),
        ).fetchone()
        == ("P5", "P5")
    )


def test_preview_is_strictly_read_only(connection: psycopg.Connection) -> None:
    member_id, _ = _schema(connection)
    assessment_id = _assessment(connection, member_id)
    _legacy_detail(connection, assessment_id, "P01.01.01")
    connection.commit()
    before = connection.execute(
        """
        SELECT a.revision, a.member_current_level_snapshot,
               ad.target_level, ad.target_compatibility_error,
               (SELECT count(*) FROM assessment_draft_target_repair_audit)
        FROM assessment a
        JOIN assessment_detail ad ON ad.assessment_id = a.id
        WHERE a.id = %s
        """,
        (assessment_id,),
    ).fetchall()

    preview = get_draft_target_repair_preview(connection, assessment_id)

    assert preview["summary"]["rebuild_count"] == 1
    assert (
        connection.execute(
            """
            SELECT a.revision, a.member_current_level_snapshot,
                   ad.target_level, ad.target_compatibility_error,
                   (SELECT count(*) FROM assessment_draft_target_repair_audit)
            FROM assessment a
            JOIN assessment_detail ad ON ad.assessment_id = a.id
            WHERE a.id = %s
            """,
            (assessment_id,),
        ).fetchall()
        == before
    )


def test_concurrent_repair_allows_exactly_one_revision(
    connection: psycopg.Connection,
) -> None:
    member_id, _ = _schema(connection)
    assessment_id = _assessment(connection, member_id)
    _legacy_detail(connection, assessment_id, "P01.01.01")
    connection.commit()

    def repair_once() -> str:
        from app.settings import settings

        with psycopg.connect(settings.database_url) as concurrent_connection:
            try:
                return str(
                    repair_draft_target_snapshots(
                        concurrent_connection,
                        assessment_id,
                        member_id,
                        expected_revision=1,
                    )["result"]
                )
            except DraftTargetRepairError as error:
                return error.code

    with ThreadPoolExecutor(max_workers=2) as executor:
        outcomes = list(executor.map(lambda _: repair_once(), range(2)))

    assert sorted(outcomes) == ["draft_repair_revision_conflict", "repaired"]
    assert (
        connection.execute(
            "SELECT revision FROM assessment WHERE id = %s", (assessment_id,)
        ).fetchone()[0]
        == 2
    )
    assert (
        connection.execute(
            "SELECT count(*) FROM assessment_draft_target_repair_audit"
        ).fetchone()[0]
        == 1
    )


def test_mismatched_legacy_snapshot_is_rebuilt_instead_of_preserved(
    connection: psycopg.Connection,
) -> None:
    member_id, _ = _schema(connection)
    assessment_id = _assessment(connection, member_id)
    connection.execute(
        """
        INSERT INTO assessment_detail (
            assessment_id, l3_code, current_level, target_level, gap_value,
            standard_target_applicable, standard_target_level,
            target_snapshot_source
        ) VALUES (%s, 'P01.01.01', 1, 5, 4, TRUE, 5,
                  'legacy_baseline_v1_repaired')
        """,
        (assessment_id,),
    )
    connection.commit()

    preview = get_draft_target_repair_preview(connection, assessment_id)
    assert preview["details"][0]["action"] == "rebuild"
    repair_draft_target_snapshots(
        connection, assessment_id, member_id, expected_revision=1
    )
    assert (
        connection.execute(
            """
        SELECT standard_target_level, target_level, gap_value
        FROM assessment_detail WHERE assessment_id = %s
        """,
            (assessment_id,),
        ).fetchone()
        == (3, 3, 2)
    )


def test_late_sql_failure_rolls_back_every_repair_write(
    connection: psycopg.Connection,
) -> None:
    member_id, _ = _schema(connection)
    assessment_id = _assessment(connection, member_id)
    _legacy_detail(connection, assessment_id, "P01.01.01")
    connection.commit()
    before = connection.execute(
        """
        SELECT a.revision, a.member_current_level_snapshot,
               ad.standard_target_level, ad.target_level,
               ad.target_compatibility_error
        FROM assessment a JOIN assessment_detail ad ON ad.assessment_id = a.id
        WHERE a.id = %s
        """,
        (assessment_id,),
    ).fetchall()

    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        repair_draft_target_snapshots(
            connection, assessment_id, 999999, expected_revision=1
        )
    assert (
        connection.execute(
            """
        SELECT a.revision, a.member_current_level_snapshot,
               ad.standard_target_level, ad.target_level,
               ad.target_compatibility_error
        FROM assessment a JOIN assessment_detail ad ON ad.assessment_id = a.id
        WHERE a.id = %s
        """,
            (assessment_id,),
        ).fetchall()
        == before
    )
    assert (
        connection.execute(
            "SELECT count(*) FROM assessment_draft_target_repair_audit"
        ).fetchone()[0]
        == 0
    )


def test_historical_assessment_is_not_repaired_or_written(
    connection: psycopg.Connection,
) -> None:
    member_id, _ = _schema(connection)
    assessment_id = _assessment(connection, member_id, "已归档")
    _legacy_detail(connection, assessment_id, "P01.01.01")
    connection.execute(
        """
        INSERT INTO assessment_review (assessment_id, sequence, status)
        VALUES (%s, 1, '已闭环')
        """,
        (assessment_id,),
    )
    connection.commit()
    before = connection.execute(
        """
        SELECT a.revision, ad.target_compatibility_error, ar.status
        FROM assessment a
        JOIN assessment_detail ad ON ad.assessment_id = a.id
        JOIN assessment_review ar ON ar.assessment_id = a.id
        WHERE a.id = %s
        """,
        (assessment_id,),
    ).fetchall()

    with pytest.raises(DraftTargetRepairError) as error:
        repair_draft_target_snapshots(
            connection, assessment_id, member_id, expected_revision=1
        )
    assert error.value.code == "draft_repair_state_conflict"
    assert (
        connection.execute(
            """
        SELECT a.revision, ad.target_compatibility_error, ar.status
        FROM assessment a
        JOIN assessment_detail ad ON ad.assessment_id = a.id
        JOIN assessment_review ar ON ar.assessment_id = a.id
        WHERE a.id = %s
        """,
            (assessment_id,),
        ).fetchall()
        == before
    )


def test_invalid_legacy_baseline_rolls_back_the_entire_migration(
    connection: psycopg.Connection,
) -> None:
    with connection.transaction():
        for table in (
            "schema_migration",
            "assessment_draft_target_repair_audit",
            "assessment_review",
            "gap",
            "assessment_detail",
            "assessment",
            "capability_standard_item",
            "capability_standard_version",
            "capability_standard_target_override",
            "capability_node",
            "capability_model",
            "tcp_session",
            "tcp_user_role",
            "tcp_role",
            "tcp_user",
        ):
            connection.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
    create_access_schema(connection)
    create_catalog_schema(connection)
    create_assessment_schema(connection)
    model_id = connection.execute(
        """
        INSERT INTO capability_model
            (code, name, version, source_workbook, source_sheet, source_row)
        VALUES ('invalid-model', 'Invalid', '1', 'test.xlsx', 'sheet', 1)
        RETURNING id
        """
    ).fetchone()[0]
    l1_id = connection.execute(
        """
        INSERT INTO capability_node
            (model_id, node_type, code, name, sort_order,
             source_workbook, source_sheet, source_row)
        VALUES (%s, 'L1', 'P01', 'Domain', 1, 'test.xlsx', 'sheet', 2)
        RETURNING id
        """,
        (model_id,),
    ).fetchone()[0]
    l2_id = connection.execute(
        """
        INSERT INTO capability_node
            (model_id, parent_node_id, node_type, code, name, sort_order,
             source_workbook, source_sheet, source_row)
        VALUES (%s, %s, 'L2', 'P01.01', 'Area', 1, 'test.xlsx', 'sheet', 3)
        RETURNING id
        """,
        (model_id, l1_id),
    ).fetchone()[0]
    l3_id = connection.execute(
        """
        INSERT INTO capability_node
            (model_id, parent_node_id, node_type, code, name, sort_order,
             recommended_start_level, source_workbook, source_sheet, source_row)
        VALUES (%s, %s, 'L3', 'P01.01.01', 'L3', 1, 'P4', 'test.xlsx', 'sheet', 4)
        RETURNING id
        """,
        (model_id, l2_id),
    ).fetchone()[0]
    connection.execute(
        """
        INSERT INTO capability_standard_target_override
            (node_id, job_level, target_level)
        VALUES (%s, 'P4', 5), (%s, 'P5', 1)
        """,
        (l3_id, l3_id),
    )
    connection.commit()

    with pytest.raises(ValueError, match="decreasing Legacy Baseline target"):
        run_migrations(connection)
    assert (
        connection.execute(
            "SELECT to_regclass('capability_standard_version')"
        ).fetchone()[0]
        is None
    )
    assert (
        connection.execute("SELECT to_regclass('schema_migration')").fetchone()[0]
        is None
    )
