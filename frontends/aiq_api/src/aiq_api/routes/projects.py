# SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Project/session application-state API routes."""

from __future__ import annotations

import logging
import os
import tempfile
from datetime import datetime
from typing import Any

from fastapi import APIRouter
from fastapi import HTTPException
from pydantic import BaseModel
from pydantic import Field

from ..app_state import get_app_state_store
from ..app_state import resolve_owner_id

logger = logging.getLogger(__name__)


def _get_optional_ingestor():
    try:
        from aiq_agent.knowledge.factory import get_active_ingestor

        return get_active_ingestor()
    except Exception as exc:
        logger.debug("Knowledge ingestor unavailable for project route: %s", exc)
        return None


def _ensure_project_collection(collection_name: str) -> None:
    ingestor = _get_optional_ingestor()
    if ingestor is None:
        return
    if ingestor.get_collection(collection_name) is not None:
        return
    ingestor.create_collection(
        name=collection_name,
        description=f"Project memory for {collection_name}",
        metadata={"memory_scope": "project"},
    )


def _promote_markdown_to_collection(
    *,
    collection_name: str,
    artifact_id: str,
    title: str,
    body_markdown: str,
) -> bool:
    ingestor = _get_optional_ingestor()
    if ingestor is None:
        return False

    _ensure_project_collection(collection_name)
    temp_path = None
    try:
        safe_title = "".join(ch if ch.isalnum() or ch in {"_", "-"} else "_" for ch in title)[:80]
        file_name = f"{artifact_id}_{safe_title or 'artifact'}.md"
        with tempfile.NamedTemporaryFile("w", delete=False, suffix=".md", encoding="utf-8") as tmp:
            tmp.write(body_markdown)
            temp_path = tmp.name

        ingestor.submit_job(
            [temp_path],
            collection_name,
            config={
                "cleanup_files": True,
                "original_filenames": [file_name],
                "custom_metadata": [{"artifact_id": artifact_id, "title": title, "artifact_kind": "project_memory"}],
            },
        )
        return True
    except Exception as exc:
        logger.warning("Failed to promote artifact %s to collection %s: %s", artifact_id, collection_name, exc)
        if temp_path:
            try:
                os.unlink(temp_path)
            except OSError:
                pass
        return False


class SessionSnapshotResponse(BaseModel):
    session_id: str
    messages: list[dict[str, Any]] = Field(default_factory=list)
    enabled_data_source_ids: list[str] = Field(default_factory=list)
    updated_at: datetime | None = None


class SessionResponse(BaseModel):
    id: str
    project_id: str
    title: str
    knowledge_collection_name: str
    knowledge_collection_name_override: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    snapshot: SessionSnapshotResponse | None = None


class ProjectResponse(BaseModel):
    id: str
    owner_id: str
    title: str
    description: str | None = None
    knowledge_collection_name: str
    created_at: datetime | None = None
    updated_at: datetime | None = None
    sessions: list[SessionResponse] = Field(default_factory=list)


class ProjectArtifactResponse(BaseModel):
    id: str
    project_id: str
    session_id: str | None = None
    kind: str
    title: str
    body_markdown: str
    citation_manifest: list[dict[str, Any]] = Field(default_factory=list)
    created_at: datetime | None = None
    promoted_to_knowledge: bool = False


class CreateProjectRequest(BaseModel):
    id: str | None = Field(default=None, max_length=64)
    title: str = Field(..., min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=4000)
    knowledge_collection_name: str | None = Field(default=None, max_length=255)
    created_at: datetime | None = None
    updated_at: datetime | None = None


class UpdateProjectRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=4000)


class CreateSessionRequest(BaseModel):
    id: str | None = Field(default=None, max_length=64)
    title: str = Field(..., min_length=1, max_length=255)
    knowledge_collection_name_override: str | None = Field(default=None, max_length=255)
    created_at: datetime | None = None
    updated_at: datetime | None = None


class UpdateSessionRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    knowledge_collection_name_override: str | None = Field(default=None, max_length=255)


class PutSessionSnapshotRequest(BaseModel):
    messages: list[dict[str, Any]] = Field(default_factory=list)
    enabled_data_source_ids: list[str] = Field(default_factory=list)
    updated_at: datetime | None = None


class CreateProjectArtifactRequest(BaseModel):
    session_id: str | None = None
    kind: str = Field(..., min_length=1, max_length=64)
    title: str = Field(..., min_length=1, max_length=255)
    body_markdown: str = Field(..., min_length=1)
    citation_manifest: list[dict[str, Any]] = Field(default_factory=list)
    artifact_id: str | None = Field(default=None, max_length=64)
    created_at: datetime | None = None
    promote_to_knowledge: bool = True


def _snapshot_response(snapshot: dict[str, Any] | None) -> SessionSnapshotResponse | None:
    if snapshot is None:
        return None
    return SessionSnapshotResponse(**snapshot)


def _session_response(session: dict[str, Any]) -> SessionResponse:
    snapshot = session.get("snapshot")
    payload = {**session, "snapshot": _snapshot_response(snapshot)}
    return SessionResponse(**payload)


def _project_response(project: dict[str, Any]) -> ProjectResponse:
    sessions = [_session_response(session) for session in project.get("sessions", [])]
    payload = {**project, "sessions": sessions}
    return ProjectResponse(**payload)


async def _require_owned_project(project_id: str) -> dict[str, Any]:
    owner_id = resolve_owner_id()
    store = get_app_state_store()
    project = await store.get_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail=f"Project not found: {project_id}")
    if project["owner_id"] != owner_id:
        raise HTTPException(status_code=404, detail=f"Project not found: {project_id}")
    return project


async def _require_owned_session(session_id: str) -> dict[str, Any]:
    owner_id = resolve_owner_id()
    store = get_app_state_store()
    session = await store.get_session(session_id, include_snapshot=True)
    if session is None:
        raise HTTPException(status_code=404, detail=f"Session not found: {session_id}")
    if session["owner_id"] != owner_id:
        raise HTTPException(status_code=404, detail=f"Session not found: {session_id}")
    return session


def add_project_routes(router: APIRouter) -> None:
    """Add project/session persistence routes to the FastAPI app."""

    @router.get(
        "/v1/projects",
        response_model=list[ProjectResponse],
        tags=["projects"],
        summary="List projects",
    )
    async def list_projects() -> list[ProjectResponse]:
        owner_id = resolve_owner_id()
        store = get_app_state_store()
        await store.ensure_default_project(owner_id)
        projects = await store.get_project_tree(owner_id)
        return [_project_response(project) for project in projects]

    @router.post(
        "/v1/projects",
        response_model=ProjectResponse,
        status_code=201,
        tags=["projects"],
        summary="Create a project",
    )
    async def create_project(request: CreateProjectRequest) -> ProjectResponse:
        owner_id = resolve_owner_id()
        store = get_app_state_store()
        project = await store.create_project(
            owner_id=owner_id,
            title=request.title,
            description=request.description,
            project_id=request.id,
            knowledge_collection_name=request.knowledge_collection_name,
            created_at=request.created_at,
            updated_at=request.updated_at,
        )
        return _project_response({**project, "sessions": []})

    @router.get(
        "/v1/projects/{project_id}",
        response_model=ProjectResponse,
        tags=["projects"],
        summary="Get project",
    )
    async def get_project(project_id: str) -> ProjectResponse:
        project = await _require_owned_project(project_id)
        store = get_app_state_store()
        sessions = await store.list_sessions(project_id, include_snapshots=True)
        return _project_response({**project, "sessions": sessions})

    @router.patch(
        "/v1/projects/{project_id}",
        response_model=ProjectResponse,
        tags=["projects"],
        summary="Update project",
    )
    async def update_project(project_id: str, request: UpdateProjectRequest) -> ProjectResponse:
        await _require_owned_project(project_id)
        store = get_app_state_store()
        project = await store.update_project(
            project_id,
            title=request.title,
            description=request.description,
        )
        if project is None:
            raise HTTPException(status_code=404, detail=f"Project not found: {project_id}")
        sessions = await store.list_sessions(project_id, include_snapshots=True)
        return _project_response({**project, "sessions": sessions})

    @router.delete(
        "/v1/projects/{project_id}",
        tags=["projects"],
        summary="Delete project",
    )
    async def delete_project(project_id: str) -> dict[str, Any]:
        project = await _require_owned_project(project_id)
        store = get_app_state_store()
        deleted = await store.delete_project(project_id)
        if deleted:
            ingestor = _get_optional_ingestor()
            if ingestor is not None:
                try:
                    if ingestor.get_collection(project["knowledge_collection_name"]) is not None:
                        ingestor.delete_collection(project["knowledge_collection_name"])
                except Exception as exc:
                    logger.warning(
                        "Failed to delete project collection %s: %s",
                        project["knowledge_collection_name"],
                        exc,
                    )
        return {"success": deleted, "project_id": project_id}

    @router.get(
        "/v1/projects/{project_id}/sessions",
        response_model=list[SessionResponse],
        tags=["projects"],
        summary="List project sessions",
    )
    async def list_project_sessions(project_id: str) -> list[SessionResponse]:
        await _require_owned_project(project_id)
        store = get_app_state_store()
        sessions = await store.list_sessions(project_id, include_snapshots=True)
        return [_session_response(session) for session in sessions]

    @router.post(
        "/v1/projects/{project_id}/sessions",
        response_model=SessionResponse,
        status_code=201,
        tags=["projects"],
        summary="Create project session",
    )
    async def create_project_session(project_id: str, request: CreateSessionRequest) -> SessionResponse:
        project = await _require_owned_project(project_id)
        store = get_app_state_store()
        try:
            session = await store.create_session(
                project_id=project_id,
                title=request.title,
                session_id=request.id,
                knowledge_collection_name_override=request.knowledge_collection_name_override,
                created_at=request.created_at,
                updated_at=request.updated_at,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        session["snapshot"] = None
        if session["knowledge_collection_name"] == project["knowledge_collection_name"]:
            _ensure_project_collection(project["knowledge_collection_name"])
        return _session_response(session)

    @router.get(
        "/v1/sessions/{session_id}",
        response_model=SessionResponse,
        tags=["sessions"],
        summary="Get session",
    )
    async def get_session(session_id: str) -> SessionResponse:
        session = await _require_owned_session(session_id)
        return _session_response(session)

    @router.patch(
        "/v1/sessions/{session_id}",
        response_model=SessionResponse,
        tags=["sessions"],
        summary="Update session",
    )
    async def update_session(session_id: str, request: UpdateSessionRequest) -> SessionResponse:
        await _require_owned_session(session_id)
        store = get_app_state_store()
        session = await store.update_session(
            session_id,
            title=request.title,
            knowledge_collection_name_override=request.knowledge_collection_name_override,
        )
        if session is None:
            raise HTTPException(status_code=404, detail=f"Session not found: {session_id}")
        return _session_response(session)

    @router.delete(
        "/v1/sessions/{session_id}",
        tags=["sessions"],
        summary="Delete session",
    )
    async def delete_session(session_id: str) -> dict[str, Any]:
        await _require_owned_session(session_id)
        store = get_app_state_store()
        deleted = await store.delete_session(session_id)
        return {"success": deleted, "session_id": session_id}

    @router.get(
        "/v1/sessions/{session_id}/snapshot",
        response_model=SessionSnapshotResponse,
        tags=["sessions"],
        summary="Get session snapshot",
    )
    async def get_session_snapshot(session_id: str) -> SessionSnapshotResponse:
        await _require_owned_session(session_id)
        store = get_app_state_store()
        snapshot = await store.get_snapshot(session_id)
        if snapshot is None:
            return SessionSnapshotResponse(session_id=session_id, messages=[], enabled_data_source_ids=[])
        return _snapshot_response(snapshot)

    @router.put(
        "/v1/sessions/{session_id}/snapshot",
        response_model=SessionSnapshotResponse,
        tags=["sessions"],
        summary="Persist session snapshot",
    )
    async def put_session_snapshot(
        session_id: str,
        request: PutSessionSnapshotRequest,
    ) -> SessionSnapshotResponse:
        await _require_owned_session(session_id)
        store = get_app_state_store()
        snapshot = await store.put_snapshot(
            session_id=session_id,
            messages=request.messages,
            enabled_data_source_ids=request.enabled_data_source_ids,
            updated_at=request.updated_at,
        )
        return _snapshot_response(snapshot)

    @router.get(
        "/v1/projects/{project_id}/artifacts",
        response_model=list[ProjectArtifactResponse],
        tags=["projects"],
        summary="List project artifacts",
    )
    async def list_project_artifacts(project_id: str) -> list[ProjectArtifactResponse]:
        await _require_owned_project(project_id)
        store = get_app_state_store()
        artifacts = await store.list_project_artifacts(project_id)
        return [ProjectArtifactResponse(**artifact) for artifact in artifacts]

    @router.post(
        "/v1/projects/{project_id}/artifacts",
        response_model=ProjectArtifactResponse,
        status_code=201,
        tags=["projects"],
        summary="Create project artifact",
    )
    async def create_project_artifact(
        project_id: str,
        request: CreateProjectArtifactRequest,
    ) -> ProjectArtifactResponse:
        project = await _require_owned_project(project_id)
        if request.session_id is not None:
            session = await _require_owned_session(request.session_id)
            if session["project_id"] != project_id:
                raise HTTPException(
                    status_code=400,
                    detail=f"Session {request.session_id} does not belong to project {project_id}",
                )

        store = get_app_state_store()
        artifact = await store.create_project_artifact(
            project_id=project_id,
            session_id=request.session_id,
            kind=request.kind,
            title=request.title,
            body_markdown=request.body_markdown,
            citation_manifest=request.citation_manifest,
            artifact_id=request.artifact_id,
            created_at=request.created_at,
        )

        promoted = False
        if request.promote_to_knowledge:
            promoted = _promote_markdown_to_collection(
                collection_name=project["knowledge_collection_name"],
                artifact_id=artifact["id"],
                title=request.title,
                body_markdown=request.body_markdown,
            )

        return ProjectArtifactResponse(**artifact, promoted_to_knowledge=promoted)
