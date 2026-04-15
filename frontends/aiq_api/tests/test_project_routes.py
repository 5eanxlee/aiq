# SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

from fastapi import APIRouter
import pytest

import aiq_api.routes.projects as projects_module


class FakeProjectStore:
    def __init__(self) -> None:
        self.created_artifacts: list[dict[str, object]] = []
        self.project = {
            "id": "project-1",
            "owner_id": "owner-1",
            "title": "Alpha Project",
            "knowledge_collection_name": "project_alpha",
        }

    async def get_project(self, project_id: str) -> dict[str, object] | None:
        if project_id != self.project["id"]:
            return None
        return self.project

    async def get_session(self, session_id: str, include_snapshot: bool = True) -> dict[str, object] | None:
        if session_id != "session-1":
            return None
        return {
            "id": "session-1",
            "owner_id": "owner-1",
            "project_id": "project-1",
            "title": "Session 1",
            "knowledge_collection_name": "project_alpha",
        }

    async def create_project_artifact(self, **kwargs: object) -> dict[str, object]:
        self.created_artifacts.append(dict(kwargs))
        return {
            "id": kwargs.get("artifact_id") or "artifact-1",
            "project_id": kwargs["project_id"],
            "session_id": kwargs["session_id"],
            "kind": kwargs["kind"],
            "title": kwargs["title"],
            "body_markdown": kwargs["body_markdown"],
            "citation_manifest": kwargs.get("citation_manifest") or [],
            "created_at": None,
        }


def _get_create_project_artifact_endpoint():
    router = APIRouter()
    projects_module.add_project_routes(router)
    for route in router.routes:
        if getattr(route, "path", None) == "/v1/projects/{project_id}/artifacts" and "POST" in getattr(
            route, "methods", set()
        ):
            return route.endpoint
    raise AssertionError("Create project artifact endpoint was not registered")


@pytest.mark.asyncio
async def test_create_project_artifact_does_not_promote_to_knowledge_by_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    endpoint = _get_create_project_artifact_endpoint()
    store = FakeProjectStore()
    promote_calls: list[dict[str, object]] = []

    monkeypatch.setattr(projects_module, "get_app_state_store", lambda: store)
    monkeypatch.setattr(projects_module, "resolve_owner_id", lambda: "owner-1")
    monkeypatch.setattr(
        projects_module,
        "_promote_markdown_to_collection",
        lambda **kwargs: promote_calls.append(kwargs) or True,
    )

    response = await endpoint(
        project_id="project-1",
        request=projects_module.CreateProjectArtifactRequest(
            kind="deep_research_report",
            title="Generated Report",
            body_markdown="# Report",
        ),
    )

    assert response.promoted_to_knowledge is False
    assert promote_calls == []
    assert len(store.created_artifacts) == 1
    assert store.created_artifacts[0]["project_id"] == "project-1"


@pytest.mark.asyncio
async def test_create_project_artifact_can_still_promote_when_explicitly_requested(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    endpoint = _get_create_project_artifact_endpoint()
    store = FakeProjectStore()
    promote_calls: list[dict[str, object]] = []

    monkeypatch.setattr(projects_module, "get_app_state_store", lambda: store)
    monkeypatch.setattr(projects_module, "resolve_owner_id", lambda: "owner-1")
    monkeypatch.setattr(
        projects_module,
        "_promote_markdown_to_collection",
        lambda **kwargs: promote_calls.append(kwargs) or True,
    )

    response = await endpoint(
        project_id="project-1",
        request=projects_module.CreateProjectArtifactRequest(
            session_id="session-1",
            kind="deep_research_report",
            title="Generated Report",
            body_markdown="# Report",
            promote_to_knowledge=True,
        ),
    )

    assert response.promoted_to_knowledge is True
    assert len(promote_calls) == 1
    assert promote_calls[0]["collection_name"] == "project_alpha"
    assert promote_calls[0]["title"] == "Generated Report"
