"""Issue #194: 显式生成所选学习任务（M02 第三独立动作）— backend tests.

Contract (docs/01_Product.md §"Issue #187 故事合同"):
- POST /api/assessments/{id}/generate-plan-items 仅处理所选 l3_codes；
- 整批零写入：任一所选项不满足即 422，本次不写入任何 plan_item/learning_task；
- per-L3 中文错误提示（含 l3_code 与原因）；
- Idempotency-Key 幂等：同键重放返回 existing 而非重复创建；
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
        for name, value in extra_headers.items():
            headers.append((name.encode("utf-8"), value.encode("utf-8")))

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
    """同一 Idempotency-Key 重放 → existing 而非重复创建。"""
    code = _ready_detail(plan_schema, gen_assessment, "m_gen")
    key = "gen-key-0001"
    status, body = _generate(plan_schema, gen_assessment, [code], key=key)
    assert status == 200 and body["created"] == [code]

    status, body = _generate(plan_schema, gen_assessment, [code], key=key)
    assert status == 200, f"replay failed: {status}: {body}"
    assert body["created"] == []
    assert body["existing"] == [code]

    count = plan_schema.execute(
        "SELECT COUNT(*) FROM plan_item pi "
        "JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id "
        "WHERE agp.member_id = (SELECT id FROM tcp_user WHERE username='m_gen')"
    ).fetchone()[0]
    assert count == 1, f"expected exactly 1 plan_item, got {count}"


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
