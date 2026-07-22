import os
from pathlib import Path

import pytest

from app.catalog.importer import (
    MODEL_WORKBOOK,
    PLAN_WORKBOOK,
    resolve_workbook_dir,
)


def test_resolve_workbook_dir_from_importer_module() -> None:
    """Resolving from the importer module itself must find the workbooks."""
    directory = resolve_workbook_dir()
    assert (directory / MODEL_WORKBOOK).is_file()
    assert (directory / PLAN_WORKBOOK).is_file()


def test_resolve_workbook_dir_from_backend_directory() -> None:
    """Resolve from the importer module file works when invoked from backend/."""
    importer_path = (
        Path(__file__).resolve().parents[1] / "app" / "catalog" / "importer.py"
    )
    directory = resolve_workbook_dir(importer_path)
    assert (directory / MODEL_WORKBOOK).is_file()
    assert (directory / PLAN_WORKBOOK).is_file()


def test_resolve_workbook_dir_ignores_cwd(tmp_path: Path) -> None:
    """The resolver must not depend on the current working directory."""
    original_cwd = os.getcwd()
    try:
        os.chdir(tmp_path)
        directory = resolve_workbook_dir()
        assert (directory / MODEL_WORKBOOK).is_file()
        assert (directory / PLAN_WORKBOOK).is_file()
    finally:
        os.chdir(original_cwd)


def test_resolve_workbook_dir_missing_files(tmp_path: Path) -> None:
    """FileNotFoundError names workbooks and searched path when files are missing."""
    fake_importer = tmp_path / "backend" / "app" / "catalog" / "importer.py"
    fake_importer.parent.mkdir(parents=True)
    fake_importer.write_text("# fake")

    with pytest.raises(FileNotFoundError) as exc_info:
        resolve_workbook_dir(fake_importer)

    message = str(exc_info.value)
    assert MODEL_WORKBOOK in message
    assert PLAN_WORKBOOK in message
    assert "capability-model" in message
