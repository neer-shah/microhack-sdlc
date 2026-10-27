from __future__ import annotations

import shutil
from collections.abc import Iterator
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from main import app


@pytest.fixture
def tmp_path() -> Iterator[Path]:
    # Keep test databases inside the project, including on shared workstations.
    path = Path(__file__).resolve().parents[1] / ".test-data" / str(uuid4())
    path.mkdir(parents=True)
    try:
        yield path
    finally:
        shutil.rmtree(path)
        try:
            path.parent.rmdir()
        except OSError:
            pass


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    source_root = Path(__file__).resolve().parents[2]
    monkeypatch.setenv("DB_FILE", str(tmp_path / "carts.db"))
    monkeypatch.setenv("DB_MIGRATIONS_DIR", str(source_root / "database" / "migrations"))
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client
