"""Issue #194: 显式生成所选学习任务（M02 第三独立动作）— backend tests.

Contract (docs/01_Product.md §"Issue #187 故事合同"):
- POST /api/assessments/{id}/generate-plan-items 仅处理所选 l3_codes；
- 整批零写入：任一所选项不满足即 422，本次不写入任何 plan_item/learning_task；
- per-L3 中文错误提示（含 l3_code 与原因）；
- Idempotency-Key 幂等：同键同 payload 重放首次响应，同键异 payload 409；
  无 key 时由 (plan_id, l3_code) 唯一键内核去重（返回 existing）；
- 生成不创建 Assessment Review、不迁移 assessment.status（保持 草稿）；
- current_level=0 是合法评级（gap>0 可生成）；
- expected_revision 不匹配 → 409 零写入。
"""

import json
from typing import Any
from urllib.parse import urlsplit

import psycopg
import pytest

from app.main import app
from tests.standard_target_support import create_scoped_draft
from tests.test_assessment_plan_selection import (
    _create_test_user,
    _detail_l3_node_id,
    _enable_one_l3,
    _login,
)
from tests.test_assessment_plan_selection import (
    plan_schema as _seed_plan_schema,
)

_L3_CODE = "C01.01.01"


@pytest.fixture
def plan_schema(connection: psycopg.Connection) -> psycopg.Connection:
    return _seed_plan_schema.__wrapped__(connection)


def _api(
    method: str,
    path: str,
    body: dict[str, object] | None = None,
    cookies: dict[str, str] | None = None,
    extra_headers: dict[str, str] | None = None,
) -> tuple[int, Any | None]:
    """Minimal ASGI request with optional extra headers (Idempotency-Key)."""
    import asyncio

    messages: list[dict[str, Any]] = []
    headers: list[tuple[bytes, bytes]] = []
    body_bytes = b""

    if body is not None:
        body_bytes = json.dumps(body).encode("utf-8")
        headers.append((b"content-type", b"application/json"))
        headers.append((b"content-length", str(len(body_bytes)).encode("utf-8")))

    if cookies:
        cookie_header = "; ".join(f"{name}={value}" for name, value in cookies.items())
        headers.append((b"cookie", cookie_header.encode("utf-8")))

    if extra_headers:
        # Starlette Headers matches on lowercase byte keys — normalize the
        # ASGI raw header name or the Idempotency-Key never arrives.
        for name, value in extra_headers.items():
            headers.append((name.lower().encode("utf-8"), value.encode("utf-8")))

    async def receive() -> dict[str, Any]:
        return {"type": "http.request", "body": body_bytes, "more_body": False}

    async def send(message: dict[str, Any]) -> None:
        messages.append(message)

    async def _run() -> None:
        await app(
            {
                "type": "http",
                "asgi": {"version": "3.0"},
                "http_version": "1.1",
                "method": method,
                "scheme": "http",
                "path": urlsplit(path).path,
                "raw_path": urlsplit(path).path.encode("utf-8"),
                "query_string": urlsplit(path).query.encode("utf-8"),
                "headers": headers,
                "client": ("testclient", 50000),
                "server": ("testserver", 80),
            },
            receive,
            send,
        )

    asyncio.run(_run())

    status_message = next(message for message in messages if "status" in message)
    status_code = status_message["status"]
    raw_body = b"".join(
        message["body"]
        for message in messages
        if message["type"] == "http.response.body"
    )
    parsed_body = json.loads(raw_body) if raw_body else None
    return status_code, parsed_body


def _ready_detail(
    connection: psycopg.Connection,
    assessment_id: int,
    username: str,
    *,
    current_level: int = 2,
    plan_month: str | None = "2026-07",
    include_in_plan: bool = True,
) -> str:
    """PATCH one detail into the new-contract ready state; returns l3_code."""
    cookies = _login(connection, username)
    code = _enable_one_l3(connection)
    node_id = _detail_l3_node_id(connection, assessment_id, code)
    assert node_id is not None, "scope-v1 detail must have l3_node_id"
    status, body = _api(
        "PATCH",
        f"/api/assessments/{assessment_id}/draft",
        {
            "details": [
                {
                    "l3_node_id": node_id,
                    "l3_code": code,
                    "current_level": current_level,
                    "target_adjusted": True,
                    "adjusted_target_level": 5,
                    "target_adjustment_reason": "test",
                    "member_priority": "高",
                    "include_in_plan": include_in_plan,
                    "plan_month": plan_month,
                }
            ],
            "expected_revision": 1,
        },
        cookies=cookies,
    )
    assert status == 200, f"ready PATCH failed: {status}: {body}"
    return code


def _generate(
    connection: psycopg.Connection,
    assessment_id: int,
    l3_codes: list[str],
    expected_revision: int = 2,
    key: str | None = None,
) -> tuple[int, Any | None]:
    cookies = _login(connection, "m_gen")
    headers = {"Idempotency-Key": key} if key else {}
    return _api(
        "POST",
        f"/api/assessments/{assessment_id}/generate-plan-items",
        {"l3_codes": l3_codes, "expected_revision": expected_revision},
        cookies=cookies,
        extra_headers=headers,
    )


@pytest.fixture
def gen_assessment(plan_schema: psycopg.Connection) -> int:
    member_id = _create_test_user(plan_schema, "m_gen", ["Member"])
    return create_scoped_draft(plan_schema, member_id, 2026)


def test_generate_plan_items_created(plan_schema, gen_assessment) -> None:
    """选中一个就绪 L3 → 200，created=1，plan_item+learning_task 落库。"""
    code = _ready_detail(plan_schema, gen_assessment, "m_gen")
    status, body = _generate(plan_schema, gen_assessment, [code])
    assert status == 200, f"generate failed: {status}: {body}"
    assert body["created"] == [code]
    assert body["existing"] == []

    row = plan_schema.execute(
        "SELECT pi.plan_month, pi.plan_quarter, lt.id "
        "FROM plan_item pi "
        "JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id "
        "LEFT JOIN learning_task lt ON lt.plan_item_id = pi.id "
        "WHERE agp.member_id = (SELECT id FROM tcp_user WHERE username='m_gen') "
        "  AND pi.l3_code = %s",
        (code,),
    ).fetchone()
    assert row is not None, "plan_item must exist"
    assert row[0] == "2026-07", f"plan_month must be TEXT YYYY-MM, got {row[0]!r}"
    assert row[1] == "Q3", f"plan_quarter must be derived, got {row[1]!r}"
    assert row[2] is not None, "learning_task must exist"


def test_generate_plan_items_idempotent(plan_schema, gen_assessment) -> None:
    """同一 Idempotency-Key + 同一 payload 重放 → 返回首次响应，不重复创建。

    Issue #194 P1-4: 同键同 payload 重放首次响应（created 与首次一致），
    而不是再次探测唯一键内核返回 existing。
    """
    code = _ready_detail(plan_schema, gen_assessment, "m_gen")
    key = "gen-key-0001"
    status, first = _generate(plan_schema, gen_assessment, [code], key=key)
    assert status == 200 and first["created"] == [code]
    assert first["existing"] == []

    status, body = _generate(plan_schema, gen_assessment, [code], key=key)
    assert status == 200, f"replay failed: {status}: {body}"
    assert body == first, f"replay must return the first response, got {body}"

    count = plan_schema.execute(
        "SELECT COUNT(*) FROM plan_item pi "
        "JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id "
        "WHERE agp.member_id = (SELECT id FROM tcp_user WHERE username='m_gen')"
    ).fetchone()[0]
    assert count == 1, f"expected exactly 1 plan_item, got {count}"


def test_generate_plan_items_replay_same_payload_no_key_returns_existing(
    plan_schema, gen_assessment
) -> None:
    """无 key 的重复生成仍由唯一键内核保证：返回 existing，不重复创建。"""
    code = _ready_detail(plan_schema, gen_assessment, "m_gen")
    status, first = _generate(plan_schema, gen_assessment, [code])
    assert status == 200 and first["created"] == [code]

    status, body = _generate(plan_schema, gen_assessment, [code])
    assert status == 200, f"regenerate failed: {status}: {body}"
    assert body["created"] == []
    assert body["existing"] == [code]

    count = plan_schema.execute(
        "SELECT COUNT(*) FROM plan_item pi "
        "JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id "
        "WHERE agp.member_id = (SELECT id FROM tcp_user WHERE username='m_gen')"
    ).fetchone()[0]
    assert count == 1, f"expected exactly 1 plan_item, got {count}"


def test_generate_plan_items_key_reused_different_payload_conflict(
    plan_schema, gen_assessment
) -> None:
    """同键不同 payload（不同 l3_codes）→ 409 idempotency_key_reused 零写入。"""
    code = _ready_detail(plan_schema, gen_assessment, "m_gen")
    key = "gen-key-0002"
    status, _ = _generate(plan_schema, gen_assessment, [code], key=key)
    assert status == 200

    status, body = _generate(plan_schema, gen_assessment, ["not-a-real-code"], key=key)
    assert status == 409, f"expected 409, got {status}: {body}"
    assert "idempotency_key_reused" in json.dumps(body, ensure_ascii=False)

    count = plan_schema.execute("SELECT COUNT(*) FROM plan_item").fetchone()[0]
    assert count == 1, f"conflict must be zero-write, got {count} plan_item(s)"


def test_generate_plan_items_key_reused_different_revision_conflict(
    plan_schema, gen_assessment
) -> None:
    """同键不同 expected_revision → 409 idempotency_key_reused。"""
    code = _ready_detail(plan_schema, gen_assessment, "m_gen")
    key = "gen-key-0003"
    status, _ = _generate(plan_schema, gen_assessment, [code], key=key)
    assert status == 200

    status, body = _generate(
        plan_schema, gen_assessment, [code], expected_revision=99, key=key
    )
    assert status == 409, f"expected 409, got {status}: {body}"
    assert "idempotency_key_reused" in json.dumps(body, ensure_ascii=False)


def test_generate_plan_items_concurrent_same_key_single_write(
    plan_schema, gen_assessment
) -> None:
    """并发同键：两个连接同时生成 → 仅一次写入，另一个拿到首次响应。"""
    code = _ready_detail(plan_schema, gen_assessment, "m_gen")
    key = "gen-key-0004"
    # 新连接用独立 cursor；同一键 + 同一 payload。
    import threading

    results: list[tuple[int, Any | None]] = []
    errors: list[BaseException] = []
    barrier = threading.Barrier(2)

    def run() -> None:
        try:
            # conn.info.dsn redacts the password — append it explicitly.
            with psycopg.connect(
                conninfo=f"{plan_schema.info.dsn} password=tcp_dev_only"
            ) as conn:
                barrier.wait()
                results.append(_generate(conn, gen_assessment, [code], key=key))
        except BaseException as exc:  # pragma: no cover - failure path
            errors.append(exc)

    threads = [threading.Thread(target=run) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert not errors, f"concurrent generate failed: {errors}"
    statuses = sorted(r[0] for r in results)
    assert statuses == [200, 200], f"expected two 200s, got {statuses}"

    count = plan_schema.execute(
        "SELECT COUNT(*) FROM plan_item pi "
        "JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id "
        "WHERE agp.member_id = (SELECT id FROM tcp_user WHERE username='m_gen')"
    ).fetchone()[0]
    assert count == 1, f"concurrent same-key must write once, got {count}"

    # 与串行首次响应一致（created 或 existing 各一枚）。
    created_counts = [r[1]["created"] for r in results]
    existing_counts = [r[1]["existing"] for r in results]
    assert created_counts.count([code]) + existing_counts.count([code]) == 2


def test_generate_plan_items_mixed_ready_unready_zero_write(
    plan_schema, gen_assessment
) -> None:
    """单选/多选混合：就绪项 + 待补月份项一起选 → 422 整批零写入。"""
    ready_code = _ready_detail(plan_schema, gen_assessment, "m_gen")
    # 第二个 L3（同一评估内）置为待补月份状态（revision 已到 2）。
    second = plan_schema.execute(
        "SELECT code FROM capability_node "
        "WHERE node_type='L3' AND code <> %s ORDER BY code LIMIT 1",
        (ready_code,),
    ).fetchone()[0]
    plan_schema.execute(
        "UPDATE capability_node SET enabled = TRUE WHERE code = %s", (second,)
    )
    plan_schema.commit()
    cookies = _login(plan_schema, "m_gen")
    node2 = _detail_l3_node_id(plan_schema, gen_assessment, str(second))
    assert node2 is not None, "scope-v1 detail must exist for the second L3"
    status, body = _api(
        "PATCH",
        f"/api/assessments/{gen_assessment}/draft",
        {
            "details": [
                {
                    "l3_node_id": node2,
                    "l3_code": str(second),
                    "current_level": 2,
                    "target_adjusted": True,
                    "adjusted_target_level": 5,
                    "target_adjustment_reason": "test",
                    "member_priority": "高",
                    "include_in_plan": True,
                    "plan_month": None,
                }
            ],
            "expected_revision": 2,
        },
        cookies=cookies,
    )
    assert status == 200, f"second PATCH failed: {status}: {body}"

    status, body = _generate(
        plan_schema, gen_assessment, [ready_code, str(second)], expected_revision=3
    )
    assert status == 422, f"mixed selection must 422: {status}: {body}"
    assert str(second) in json.dumps(body, ensure_ascii=False)

    count = plan_schema.execute(
        "SELECT COUNT(*) FROM plan_item pi "
        "JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id "
        "WHERE agp.member_id = (SELECT id FROM tcp_user WHERE username='m_gen')"
    ).fetchone()[0]
    assert count == 0, f"zero write violated: {count} plan_item(s) created"


def test_generate_plan_items_pending_month_zero_write(
    plan_schema, gen_assessment
) -> None:
    """待补计划月份 L3 被选中 → 422 per-L3 中文错误；整批零写入。"""
    code = _ready_detail(plan_schema, gen_assessment, "m_gen", plan_month=None)
    status, body = _generate(plan_schema, gen_assessment, [code])
    assert status == 422, f"pending month must block generation: {status}: {body}"
    assert code in json.dumps(body, ensure_ascii=False), "错误需含 l3_code"
    assert "计划月份" in json.dumps(body, ensure_ascii=False), "错误需为中文"

    count = plan_schema.execute(
        "SELECT COUNT(*) FROM plan_item pi "
        "JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id "
        "WHERE agp.member_id = (SELECT id FROM tcp_user WHERE username='m_gen')"
    ).fetchone()[0]
    assert count == 0, f"zero write violated: {count} plan_item(s) created"

    # 输入保留：草稿仍为待补月份状态
    row = plan_schema.execute(
        "SELECT include_in_plan, plan_month FROM assessment_detail ad "
        "JOIN assessment a ON a.id = ad.assessment_id "
        "WHERE a.member_id = (SELECT id FROM tcp_user WHERE username='m_gen') "
        "  AND ad.l3_code = %s",
        (code,),
    ).fetchone()
    assert row[0] is True and row[1] is None


def test_generate_plan_items_year_mismatch_zero_write(
    plan_schema, gen_assessment
) -> None:
    """plan_month 年份与评估年份（2026）不符 → 422 per-L3 中文错误，零写入。"""
    code = _ready_detail(plan_schema, gen_assessment, "m_gen", plan_month="2030-05")
    status, body = _generate(plan_schema, gen_assessment, [code])
    assert status == 422, f"year mismatch must block: {status}: {body}"
    assert code in json.dumps(body, ensure_ascii=False), "错误需含 l3_code"
    assert "年份" in json.dumps(body, ensure_ascii=False), "错误需为中文"

    count = plan_schema.execute(
        "SELECT COUNT(*) FROM plan_item pi "
        "JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id "
        "WHERE agp.member_id = (SELECT id FROM tcp_user WHERE username='m_gen')"
    ).fetchone()[0]
    assert count == 0, f"zero write violated: {count} plan_item(s) created"


def test_generate_plan_items_revision_conflict(plan_schema, gen_assessment) -> None:
    """expected_revision 不匹配 → 409 零写入。"""
    code = _ready_detail(plan_schema, gen_assessment, "m_gen")
    status, body = _generate(plan_schema, gen_assessment, [code], expected_revision=99)
    assert status == 409, f"expected 409, got {status}: {body}"
    count = plan_schema.execute("SELECT COUNT(*) FROM plan_item").fetchone()[0]
    assert count == 0, f"zero write violated: {count} plan_item(s) created"


def test_generate_plan_items_current_level_zero(plan_schema, gen_assessment) -> None:
    """current_level=0 是合法评级，可生成（0 与 NULL 不同）。"""
    code = _ready_detail(plan_schema, gen_assessment, "m_gen", current_level=0)
    status, body = _generate(plan_schema, gen_assessment, [code])
    assert status == 200, f"level 0 should generate: {status}: {body}"
    assert body["created"] == [code]


def test_generate_plan_items_no_review_no_status_change(
    plan_schema, gen_assessment
) -> None:
    """生成不创建 Assessment Review、assessment.status 保持 草稿。"""
    code = _ready_detail(plan_schema, gen_assessment, "m_gen")
    status, body = _generate(plan_schema, gen_assessment, [code])
    assert status == 200

    row = plan_schema.execute(
        "SELECT status FROM assessment WHERE id = %s", (gen_assessment,)
    ).fetchone()
    assert row[0] == "草稿", f"status must stay 草稿, got {row[0]}"

    review_count = plan_schema.execute(
        "SELECT COUNT(*) FROM assessment_review WHERE assessment_id = %s",
        (gen_assessment,),
    ).fetchone()[0]
    assert review_count == 0, "no Assessment Review may be created"
