# SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

from io import BytesIO
import os
from types import SimpleNamespace

from fastapi import APIRouter
from fastapi import HTTPException
from fastapi import UploadFile
import pytest
from starlette.datastructures import Headers

import aiq_api.routes.documents as documents_module
from aiq_agent.knowledge.schema import FileInfo
from aiq_agent.knowledge.schema import FileStatus


class FakeIngestor:
    def __init__(self) -> None:
        self.submitted_paths: list[str] = []
        self.submitted_collection_name: str | None = None
        self.submitted_config: dict | None = None

    def get_collection(self, _collection_name: str) -> dict[str, str]:
        return {"name": "test"}

    def submit_job(self, temp_paths: list[str], collection_name: str, config: dict) -> str:
        self.submitted_paths = list(temp_paths)
        self.submitted_collection_name = collection_name
        self.submitted_config = config
        return "job-1"

    def get_job_status(self, _job_id: str) -> SimpleNamespace:
        return SimpleNamespace(
            file_details=[
                SimpleNamespace(file_id=f"file-{index}")
                for index, _ in enumerate(self.submitted_paths)
            ]
        )


def _get_upload_endpoint():
    router = APIRouter()
    documents_module.add_document_routes(router)
    for route in router.routes:
        if getattr(route, "path", None) == "/v1/collections/{collection_name}/documents" and "POST" in getattr(route, "methods", set()):
            return route.endpoint
    raise AssertionError("Upload documents endpoint was not registered")


def _get_list_documents_endpoint():
    router = APIRouter()
    documents_module.add_document_routes(router)
    for route in router.routes:
        if getattr(route, "path", None) == "/v1/collections/{collection_name}/documents" and "GET" in getattr(route, "methods", set()):
            return route.endpoint
    raise AssertionError("List documents endpoint was not registered")


def _make_upload_file(name: str, content: bytes, content_type: str = "text/plain") -> UploadFile:
    return UploadFile(
        file=BytesIO(content),
        filename=name,
        headers=Headers({"content-type": content_type}),
    )


@pytest.mark.asyncio
async def test_upload_documents_closes_each_upload_before_staging(monkeypatch: pytest.MonkeyPatch) -> None:
    endpoint = _get_upload_endpoint()
    ingestor = FakeIngestor()
    upload_files = [
        _make_upload_file("alpha.txt", b"alpha"),
        _make_upload_file("beta.txt", b"beta"),
    ]

    staged_paths: list[str] = []
    finalized: list[tuple[str, str, str]] = []

    def _stage_uploaded_document(
        *,
        collection_name: str,
        source_path: str,
        original_filename: str,
        content_type: str | None,
    ) -> str:
        file_index = len(staged_paths)
        assert upload_files[file_index].file.closed
        assert collection_name == "project_memory"
        assert original_filename in {"alpha.txt", "beta.txt"}
        assert content_type == "text/plain"
        staged_paths.append(source_path)
        return f"pending-{file_index}"

    monkeypatch.setattr(documents_module, "stage_uploaded_document", _stage_uploaded_document)
    monkeypatch.setattr(
        documents_module,
        "finalize_staged_document",
        lambda collection_name, pending_id, file_id: finalized.append((collection_name, pending_id, file_id)),
    )
    monkeypatch.setattr(documents_module, "discard_staged_documents", lambda *_args, **_kwargs: None)

    response = await endpoint(
        collection_name="project_memory",
        files=upload_files,
        ingestor=ingestor,
    )

    assert response.job_id == "job-1"
    assert response.file_ids == ["file-0", "file-1"]
    assert all(upload_file.file.closed for upload_file in upload_files)
    assert finalized == [
        ("project_memory", "pending-0", "file-0"),
        ("project_memory", "pending-1", "file-1"),
    ]

    for path in ingestor.submitted_paths:
        try:
            os.unlink(path)
        except OSError:
            pass


@pytest.mark.asyncio
async def test_upload_documents_closes_remaining_upload_handles_when_staging_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    endpoint = _get_upload_endpoint()
    ingestor = FakeIngestor()
    upload_files = [
        _make_upload_file("alpha.txt", b"alpha"),
        _make_upload_file("beta.txt", b"beta"),
    ]

    def _stage_uploaded_document(**_kwargs: object) -> str:
        assert upload_files[0].file.closed
        raise OSError(24, "Too many open files")

    monkeypatch.setattr(documents_module, "stage_uploaded_document", _stage_uploaded_document)
    monkeypatch.setattr(documents_module, "discard_staged_documents", lambda *_args, **_kwargs: None)

    with pytest.raises(HTTPException) as exc_info:
        await endpoint(
            collection_name="project_memory",
            files=upload_files,
            ingestor=ingestor,
        )

    assert exc_info.value.status_code == 500
    assert "Too many open files" in str(exc_info.value.detail)
    assert all(upload_file.file.closed for upload_file in upload_files)


@pytest.mark.asyncio
async def test_list_documents_filters_generated_artifact_files() -> None:
    endpoint = _get_list_documents_endpoint()
    ingestor = FakeIngestor()
    ingestor.list_files = lambda _collection_name: [
        FileInfo(
            file_id="manual-1",
            file_name="notes.pdf",
            collection_name="project_memory",
            status=FileStatus.SUCCESS,
            metadata={},
        ),
        FileInfo(
            file_id="artifact-1",
            file_name="artifact_report.md",
            collection_name="project_memory",
            status=FileStatus.SUCCESS,
            metadata={"artifact_kind": "deep_research_report"},
        ),
    ]

    response = await endpoint(
        collection_name="project_memory",
        ingestor=ingestor,
    )

    assert [file_info.file_id for file_info in response] == ["manual-1"]
