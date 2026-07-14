import asyncio
from pathlib import Path

import psycopg

from app.catalog.repository import get_capability_model, list_learning_resources
from app.main import lifespan
from app.settings import settings

WORKBOOK_DIR = Path("/app/capability-model")
WORKBOOKS = (
    "技术架构与开发专业线能力胜任模型20260509_V1.0.xlsx",
    "团队成员年度学习计划模板_基于能力模型_V1.3.xlsx",
)


def reset_catalog() -> None:
    with psycopg.connect(settings.database_url) as connection:
        with connection.transaction():
            connection.execute("DROP TABLE IF EXISTS capability_node_resource")
            connection.execute("DROP TABLE IF EXISTS learning_resource")
            connection.execute("DROP TABLE IF EXISTS capability_node")
            connection.execute("DROP TABLE IF EXISTS capability_model")


def test_image_workbooks_bootstrap_the_catalog_baseline() -> None:
    assert all((WORKBOOK_DIR / workbook).is_file() for workbook in WORKBOOKS)

    reset_catalog()
    asyncio.run(_initialize())

    with psycopg.connect(settings.database_url) as connection:
        model = get_capability_model(connection, None)
        resources = list_learning_resources(connection, None, None, None)

    assert model is not None
    assert {domain["code"] for domain in model["domains"]} == {
        "P01",
        "P02",
        "P03",
        "C01",
        "C02",
        "C03",
    }
    assert sum(len(domain["children"]) for domain in model["domains"]) == 47
    assert (
        sum(
            len(l2["children"])
            for domain in model["domains"]
            for l2 in domain["children"]
        )
        == 310
    )
    assert len(resources) == 95


async def _initialize() -> None:
    async with lifespan(None):
        pass
