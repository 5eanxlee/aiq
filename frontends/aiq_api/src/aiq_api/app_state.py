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

"""Persistent application state for projects, sessions, snapshots, and artifacts."""

from __future__ import annotations

import json
import logging
import os
import threading
import time
import uuid
from datetime import UTC
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import Column
from sqlalchemy import DateTime
from sqlalchemy import ForeignKey
from sqlalchemy import Index
from sqlalchemy import MetaData
from sqlalchemy import String
from sqlalchemy import Table
from sqlalchemy import Text
from sqlalchemy import event
from sqlalchemy import select

logger = logging.getLogger(__name__)

DEFAULT_APP_STATE_DB_URL = "sqlite+aiosqlite:///./var/app_state.db"
DEFAULT_OWNER_ID = "default-user"
DEFAULT_PROJECT_TITLE = "General"

ENGINE_CACHE_TTL_SECONDS = 3600
ENGINE_CACHE_MAX_SIZE = 10


def _now_utc() -> datetime:
    return datetime.now(tz=UTC)


def _normalize_db_url(db_url: str, *, async_mode: bool) -> str:
    """Normalize database URL to use consistent drivers."""
    if db_url.startswith("postgresql") or db_url.startswith("postgres"):
        base_url = db_url.replace("+asyncpg", "").replace("+psycopg2", "").replace("+psycopg", "")
        if not base_url.startswith("postgresql://"):
            base_url = base_url.replace("postgres://", "postgresql://")
        if async_mode:
            return base_url.replace("postgresql://", "postgresql+psycopg://")
        return base_url.replace("postgresql://", "postgresql+psycopg://")
    if db_url.startswith("sqlite"):
        base_url = db_url.replace("+aiosqlite", "")
        if async_mode:
            return base_url.replace("sqlite:///", "sqlite+aiosqlite:///")
        return base_url
    return db_url


def _ensure_sqlite_parent_dir(db_url: str) -> None:
    if not db_url.startswith("sqlite") or ":memory:" in db_url:
        return

    base_url = db_url.replace("+aiosqlite", "")
    if not base_url.startswith("sqlite:///"):
        return

    db_path = Path(base_url.replace("sqlite:///", "", 1))
    db_path.parent.mkdir(parents=True, exist_ok=True)


def _coerce_datetime(value: datetime | str | None) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value)
        except ValueError:
            return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _dump_json(value: Any | None) -> str | None:
    if value is None:
        return None
    return json.dumps(value)


def _load_json(value: str | None, *, default: Any) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        logger.warning("Failed to decode app-state JSON payload")
        return default


def _generate_prefixed_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


def _normalize_collection_name(project_id: str) -> str:
    safe = "".join(ch if ch.isalnum() or ch == "_" else "_" for ch in project_id)
    return f"project_{safe}"


def resolve_owner_id() -> str:
    """Resolve the current owner identity or fall back to the local default user."""
    try:
        from aiq_agent.auth import get_current_user_info

        user_info = get_current_user_info()
        if user_info:
            return user_info.email or user_info.name or DEFAULT_OWNER_ID
    except Exception as exc:
        logger.debug("Failed to resolve current user info for app state: %s", exc)
    return DEFAULT_OWNER_ID


metadata = MetaData()

projects_table = Table(
    "projects",
    metadata,
    Column("id", String(64), primary_key=True),
    Column("owner_id", String(256), nullable=False, index=True),
    Column("title", String(255), nullable=False),
    Column("description", Text, nullable=True),
    Column("knowledge_collection_name", String(255), nullable=False, unique=True),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False),
    Index("idx_projects_owner_updated", "owner_id", "updated_at"),
)

sessions_table = Table(
    "sessions",
    metadata,
    Column("id", String(64), primary_key=True),
    Column("project_id", String(64), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True),
    Column("title", String(255), nullable=False),
    Column("knowledge_collection_name_override", String(255), nullable=True),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False),
    Index("idx_sessions_project_updated", "project_id", "updated_at"),
)

session_snapshots_table = Table(
    "session_snapshots",
    metadata,
    Column("session_id", String(64), ForeignKey("sessions.id", ondelete="CASCADE"), primary_key=True),
    Column("messages_json", Text, nullable=False),
    Column("enabled_data_sources_json", Text, nullable=True),
    Column("updated_at", DateTime(timezone=True), nullable=False),
)

project_artifacts_table = Table(
    "project_artifacts",
    metadata,
    Column("id", String(64), primary_key=True),
    Column("project_id", String(64), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True),
    Column("session_id", String(64), ForeignKey("sessions.id", ondelete="SET NULL"), nullable=True, index=True),
    Column("kind", String(64), nullable=False),
    Column("title", String(255), nullable=False),
    Column("body_markdown", Text, nullable=False),
    Column("citation_manifest_json", Text, nullable=True),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Index("idx_project_artifacts_project_created", "project_id", "created_at"),
)


def _serialize_snapshot_row(row: Any) -> dict[str, Any] | None:
    if row is None:
        return None
    mapping = dict(row)
    return {
        "session_id": mapping["session_id"],
        "messages": _load_json(mapping.get("messages_json"), default=[]),
        "enabled_data_source_ids": _load_json(mapping.get("enabled_data_sources_json"), default=[]),
        "updated_at": _coerce_datetime(mapping.get("updated_at")),
    }


def _serialize_project_row(row: Any) -> dict[str, Any]:
    mapping = dict(row)
    return {
        "id": mapping["id"],
        "owner_id": mapping["owner_id"],
        "title": mapping["title"],
        "description": mapping.get("description"),
        "knowledge_collection_name": mapping["knowledge_collection_name"],
        "created_at": _coerce_datetime(mapping.get("created_at")),
        "updated_at": _coerce_datetime(mapping.get("updated_at")),
    }


def _serialize_session_row(row: Any, *, project_collection_name: str | None = None) -> dict[str, Any]:
    mapping = dict(row)
    effective_collection = mapping.get("knowledge_collection_name_override") or project_collection_name or mapping["id"]
    return {
        "id": mapping["id"],
        "project_id": mapping["project_id"],
        "title": mapping["title"],
        "knowledge_collection_name_override": mapping.get("knowledge_collection_name_override"),
        "knowledge_collection_name": effective_collection,
        "created_at": _coerce_datetime(mapping.get("created_at")),
        "updated_at": _coerce_datetime(mapping.get("updated_at")),
    }


def _serialize_artifact_row(row: Any) -> dict[str, Any]:
    mapping = dict(row)
    return {
        "id": mapping["id"],
        "project_id": mapping["project_id"],
        "session_id": mapping.get("session_id"),
        "kind": mapping["kind"],
        "title": mapping["title"],
        "body_markdown": mapping["body_markdown"],
        "citation_manifest": _load_json(mapping.get("citation_manifest_json"), default=[]),
        "created_at": _coerce_datetime(mapping.get("created_at")),
    }


class AppStateStore:
    """SQLAlchemy-backed store for project/session app state."""

    _async_engine_cache: dict[str, tuple[Any, float]] = {}
    _sync_engine_cache: dict[str, tuple[Any, float]] = {}
    _cache_lock = threading.Lock()
    _tables_initialized: set[str] = set()

    def __init__(self, db_url: str | None = None):
        self.db_url = db_url or os.environ.get("AIQ_APP_STATE_DB", DEFAULT_APP_STATE_DB_URL)
        self._sync_engine = self._get_or_create_sync_engine(self.db_url)
        self._ensure_tables_sync()

    @classmethod
    def _cleanup_stale_engines(cls, cache: dict[str, tuple[Any, float]]) -> None:
        now = time.monotonic()
        stale_keys = [key for key, (_, last_used) in cache.items() if now - last_used > ENGINE_CACHE_TTL_SECONDS]
        for key in stale_keys:
            engine, _ = cache.pop(key, (None, 0))
            if engine is None:
                continue
            try:
                engine.dispose()
            except Exception as exc:
                logger.warning("Failed to dispose stale app-state engine: %s", exc)

        if len(cache) <= ENGINE_CACHE_MAX_SIZE:
            return

        sorted_entries = sorted(cache.items(), key=lambda item: item[1][1])
        for key, (engine, _) in sorted_entries[: len(sorted_entries) - ENGINE_CACHE_MAX_SIZE]:
            cache.pop(key, None)
            try:
                engine.dispose()
            except Exception:
                pass

    @classmethod
    def _install_sqlite_pragma(cls, engine: Any) -> None:
        @event.listens_for(engine, "connect")
        def _set_sqlite_pragma(dbapi_connection, _connection_record) -> None:
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    @classmethod
    def _get_or_create_sync_engine(cls, db_url: str):
        with cls._cache_lock:
            cls._cleanup_stale_engines(cls._sync_engine_cache)
            if db_url in cls._sync_engine_cache:
                engine, _ = cls._sync_engine_cache[db_url]
                cls._sync_engine_cache[db_url] = (engine, time.monotonic())
                return engine

            from sqlalchemy import create_engine

            normalized_url = _normalize_db_url(db_url, async_mode=False)
            _ensure_sqlite_parent_dir(normalized_url)
            is_sqlite = normalized_url.startswith("sqlite")
            connect_args = {"check_same_thread": False, "timeout": 30} if is_sqlite else {}
            engine = create_engine(
                normalized_url,
                pool_pre_ping=True,
                pool_size=1 if is_sqlite else 5,
                max_overflow=0 if is_sqlite else 10,
                connect_args=connect_args,
            )
            if is_sqlite:
                cls._install_sqlite_pragma(engine)
            cls._sync_engine_cache[db_url] = (engine, time.monotonic())
            return engine

    @classmethod
    def _get_or_create_async_engine(cls, db_url: str):
        with cls._cache_lock:
            cls._cleanup_stale_engines(cls._async_engine_cache)
            if db_url in cls._async_engine_cache:
                engine, _ = cls._async_engine_cache[db_url]
                cls._async_engine_cache[db_url] = (engine, time.monotonic())
                return engine

            from sqlalchemy.ext.asyncio import create_async_engine

            normalized_url = _normalize_db_url(db_url, async_mode=True)
            _ensure_sqlite_parent_dir(normalized_url)
            is_sqlite = normalized_url.startswith("sqlite")
            engine = create_async_engine(
                normalized_url,
                pool_pre_ping=True,
                pool_size=1 if is_sqlite else 5,
                max_overflow=0 if is_sqlite else 10,
            )
            if is_sqlite:
                sync_engine = engine.sync_engine
                cls._install_sqlite_pragma(sync_engine)
            cls._async_engine_cache[db_url] = (engine, time.monotonic())
            return engine

    def _ensure_tables_sync(self) -> None:
        with AppStateStore._cache_lock:
            if self.db_url in AppStateStore._tables_initialized:
                return
            metadata.create_all(self._sync_engine)
            AppStateStore._tables_initialized.add(self.db_url)

    @classmethod
    async def _ensure_tables_async(cls, db_url: str) -> None:
        if db_url in cls._tables_initialized:
            return
        engine = cls._get_or_create_async_engine(db_url)
        async with engine.begin() as conn:
            await conn.run_sync(lambda sync_conn: metadata.create_all(sync_conn))
        cls._tables_initialized.add(db_url)

    async def _get_engine(self):
        await self._ensure_tables_async(self.db_url)
        return self._get_or_create_async_engine(self.db_url)

    @classmethod
    async def dispose_all_engines_async(cls) -> None:
        with cls._cache_lock:
            async_cache = list(cls._async_engine_cache.values())
            sync_cache = list(cls._sync_engine_cache.values())
            cls._async_engine_cache.clear()
            cls._sync_engine_cache.clear()
            cls._tables_initialized.clear()

        for engine, _ in async_cache:
            try:
                await engine.dispose()
            except Exception as exc:
                logger.warning("Failed to dispose async app-state engine: %s", exc)

        for engine, _ in sync_cache:
            try:
                engine.dispose()
            except Exception as exc:
                logger.warning("Failed to dispose sync app-state engine: %s", exc)

    async def ensure_default_project(self, owner_id: str) -> dict[str, Any]:
        project = await self.get_default_project(owner_id)
        if project is not None:
            return project
        return await self.create_project(owner_id=owner_id, title=DEFAULT_PROJECT_TITLE)

    async def get_default_project(self, owner_id: str) -> dict[str, Any] | None:
        engine = await self._get_engine()
        async with engine.connect() as conn:
            result = await conn.execute(
                select(projects_table)
                .where(projects_table.c.owner_id == owner_id)
                .order_by(projects_table.c.created_at.asc())
                .limit(1)
            )
            row = result.mappings().first()
        return _serialize_project_row(row) if row else None

    async def list_projects(self, owner_id: str) -> list[dict[str, Any]]:
        engine = await self._get_engine()
        async with engine.connect() as conn:
            result = await conn.execute(
                select(projects_table)
                .where(projects_table.c.owner_id == owner_id)
                .order_by(projects_table.c.updated_at.desc(), projects_table.c.created_at.desc())
            )
            rows = result.mappings().all()
        return [_serialize_project_row(row) for row in rows]

    async def get_project(self, project_id: str) -> dict[str, Any] | None:
        engine = await self._get_engine()
        async with engine.connect() as conn:
            result = await conn.execute(select(projects_table).where(projects_table.c.id == project_id))
            row = result.mappings().first()
        return _serialize_project_row(row) if row else None

    async def create_project(
        self,
        *,
        owner_id: str,
        title: str,
        description: str | None = None,
        project_id: str | None = None,
        knowledge_collection_name: str | None = None,
        created_at: datetime | None = None,
        updated_at: datetime | None = None,
    ) -> dict[str, Any]:
        resolved_project_id = project_id or _generate_prefixed_id("p")
        now = _now_utc()
        created = _coerce_datetime(created_at) or now
        updated = _coerce_datetime(updated_at) or created
        resolved_collection = knowledge_collection_name or _normalize_collection_name(resolved_project_id)

        existing = await self.get_project(resolved_project_id)
        if existing is not None:
            return existing

        engine = await self._get_engine()
        async with engine.begin() as conn:
            await conn.execute(
                projects_table.insert().values(
                    id=resolved_project_id,
                    owner_id=owner_id,
                    title=title,
                    description=description,
                    knowledge_collection_name=resolved_collection,
                    created_at=created,
                    updated_at=updated,
                )
            )
        return {
            "id": resolved_project_id,
            "owner_id": owner_id,
            "title": title,
            "description": description,
            "knowledge_collection_name": resolved_collection,
            "created_at": created,
            "updated_at": updated,
        }

    async def update_project(
        self,
        project_id: str,
        *,
        title: str | None = None,
        description: str | None = None,
    ) -> dict[str, Any] | None:
        existing = await self.get_project(project_id)
        if existing is None:
            return None

        values: dict[str, Any] = {"updated_at": _now_utc()}
        if title is not None:
            values["title"] = title
        if description is not None:
            values["description"] = description

        engine = await self._get_engine()
        async with engine.begin() as conn:
            await conn.execute(
                projects_table.update().where(projects_table.c.id == project_id).values(**values)
            )
        return await self.get_project(project_id)

    async def delete_project(self, project_id: str) -> bool:
        engine = await self._get_engine()
        async with engine.begin() as conn:
            result = await conn.execute(projects_table.delete().where(projects_table.c.id == project_id))
        return result.rowcount > 0

    async def list_sessions(self, project_id: str, *, include_snapshots: bool = True) -> list[dict[str, Any]]:
        project = await self.get_project(project_id)
        if project is None:
            return []

        engine = await self._get_engine()
        async with engine.connect() as conn:
            result = await conn.execute(
                select(sessions_table)
                .where(sessions_table.c.project_id == project_id)
                .order_by(sessions_table.c.updated_at.desc(), sessions_table.c.created_at.desc())
            )
            session_rows = result.mappings().all()

            snapshot_map: dict[str, dict[str, Any] | None] = {}
            if include_snapshots and session_rows:
                session_ids = [row["id"] for row in session_rows]
                snapshot_result = await conn.execute(
                    select(session_snapshots_table).where(session_snapshots_table.c.session_id.in_(session_ids))
                )
                snapshot_rows = snapshot_result.mappings().all()
                snapshot_map = {row["session_id"]: _serialize_snapshot_row(row) for row in snapshot_rows}

        sessions = []
        for row in session_rows:
            session = _serialize_session_row(row, project_collection_name=project["knowledge_collection_name"])
            if include_snapshots:
                session["snapshot"] = snapshot_map.get(session["id"])
            sessions.append(session)
        return sessions

    async def get_session(self, session_id: str, *, include_snapshot: bool = True) -> dict[str, Any] | None:
        engine = await self._get_engine()
        async with engine.connect() as conn:
            result = await conn.execute(
                select(
                    sessions_table,
                    projects_table.c.knowledge_collection_name.label("project_collection_name"),
                    projects_table.c.owner_id.label("owner_id"),
                )
                .select_from(sessions_table.join(projects_table, sessions_table.c.project_id == projects_table.c.id))
                .where(sessions_table.c.id == session_id)
            )
            row = result.mappings().first()
            if row is None:
                return None

            session = _serialize_session_row(row, project_collection_name=row["project_collection_name"])
            session["owner_id"] = row["owner_id"]
            if include_snapshot:
                snapshot_result = await conn.execute(
                    select(session_snapshots_table).where(session_snapshots_table.c.session_id == session_id)
                )
                snapshot_row = snapshot_result.mappings().first()
                session["snapshot"] = _serialize_snapshot_row(snapshot_row)
            return session

    async def create_session(
        self,
        *,
        project_id: str,
        title: str,
        session_id: str | None = None,
        knowledge_collection_name_override: str | None = None,
        created_at: datetime | None = None,
        updated_at: datetime | None = None,
    ) -> dict[str, Any]:
        resolved_session_id = session_id or _generate_prefixed_id("s")
        now = _now_utc()
        created = _coerce_datetime(created_at) or now
        updated = _coerce_datetime(updated_at) or created

        existing = await self.get_session(resolved_session_id, include_snapshot=False)
        if existing is not None:
            if existing["project_id"] != project_id:
                raise ValueError(
                    f"Session {resolved_session_id} already exists in project {existing['project_id']}"
                )
            values: dict[str, Any] = {}
            if title and title != existing["title"]:
                values["title"] = title
            if knowledge_collection_name_override != existing.get("knowledge_collection_name_override"):
                values["knowledge_collection_name_override"] = knowledge_collection_name_override
            if values:
                values["updated_at"] = updated
                engine = await self._get_engine()
                async with engine.begin() as conn:
                    await conn.execute(
                        sessions_table.update().where(sessions_table.c.id == resolved_session_id).values(**values)
                    )
                    await conn.execute(
                        projects_table.update().where(projects_table.c.id == project_id).values(updated_at=updated)
                    )
            return await self.get_session(resolved_session_id, include_snapshot=False) or existing

        project = await self.get_project(project_id)
        if project is None:
            raise ValueError(f"Project not found: {project_id}")

        engine = await self._get_engine()
        async with engine.begin() as conn:
            await conn.execute(
                sessions_table.insert().values(
                    id=resolved_session_id,
                    project_id=project_id,
                    title=title,
                    knowledge_collection_name_override=knowledge_collection_name_override,
                    created_at=created,
                    updated_at=updated,
                )
            )
            await conn.execute(
                projects_table.update()
                .where(projects_table.c.id == project_id)
                .values(updated_at=max(project["updated_at"], updated) if project["updated_at"] else updated)
            )

        return {
            "id": resolved_session_id,
            "project_id": project_id,
            "title": title,
            "knowledge_collection_name_override": knowledge_collection_name_override,
            "knowledge_collection_name": knowledge_collection_name_override or project["knowledge_collection_name"],
            "created_at": created,
            "updated_at": updated,
        }

    async def update_session(
        self,
        session_id: str,
        *,
        title: str | None = None,
        knowledge_collection_name_override: str | None = None,
    ) -> dict[str, Any] | None:
        existing = await self.get_session(session_id, include_snapshot=False)
        if existing is None:
            return None

        values: dict[str, Any] = {"updated_at": _now_utc()}
        if title is not None:
            values["title"] = title
        if knowledge_collection_name_override is not None:
            values["knowledge_collection_name_override"] = knowledge_collection_name_override

        engine = await self._get_engine()
        async with engine.begin() as conn:
            await conn.execute(
                sessions_table.update().where(sessions_table.c.id == session_id).values(**values)
            )
            await conn.execute(
                projects_table.update()
                .where(projects_table.c.id == existing["project_id"])
                .values(updated_at=values["updated_at"])
            )
        return await self.get_session(session_id, include_snapshot=True)

    async def delete_session(self, session_id: str) -> bool:
        session = await self.get_session(session_id, include_snapshot=False)
        if session is None:
            return False

        engine = await self._get_engine()
        async with engine.begin() as conn:
            result = await conn.execute(sessions_table.delete().where(sessions_table.c.id == session_id))
            await conn.execute(
                projects_table.update()
                .where(projects_table.c.id == session["project_id"])
                .values(updated_at=_now_utc())
            )
        return result.rowcount > 0

    async def get_snapshot(self, session_id: str) -> dict[str, Any] | None:
        engine = await self._get_engine()
        async with engine.connect() as conn:
            result = await conn.execute(
                select(session_snapshots_table).where(session_snapshots_table.c.session_id == session_id)
            )
            row = result.mappings().first()
        return _serialize_snapshot_row(row)

    async def put_snapshot(
        self,
        *,
        session_id: str,
        messages: list[dict[str, Any]] | list[Any],
        enabled_data_source_ids: list[str] | None = None,
        updated_at: datetime | None = None,
    ) -> dict[str, Any]:
        session = await self.get_session(session_id, include_snapshot=False)
        if session is None:
            raise ValueError(f"Session not found: {session_id}")

        timestamp = _coerce_datetime(updated_at) or _now_utc()
        payload = {
            "session_id": session_id,
            "messages_json": _dump_json(messages) or "[]",
            "enabled_data_sources_json": _dump_json(enabled_data_source_ids or []),
            "updated_at": timestamp,
        }

        existing = await self.get_snapshot(session_id)
        engine = await self._get_engine()
        async with engine.begin() as conn:
            if existing is None:
                await conn.execute(session_snapshots_table.insert().values(**payload))
            else:
                await conn.execute(
                    session_snapshots_table.update()
                    .where(session_snapshots_table.c.session_id == session_id)
                    .values(**payload)
                )
            await conn.execute(
                sessions_table.update().where(sessions_table.c.id == session_id).values(updated_at=timestamp)
            )
            await conn.execute(
                projects_table.update()
                .where(projects_table.c.id == session["project_id"])
                .values(updated_at=timestamp)
            )
        return {
            "session_id": session_id,
            "messages": messages,
            "enabled_data_source_ids": enabled_data_source_ids or [],
            "updated_at": timestamp,
        }

    async def list_project_artifacts(self, project_id: str) -> list[dict[str, Any]]:
        engine = await self._get_engine()
        async with engine.connect() as conn:
            result = await conn.execute(
                select(project_artifacts_table)
                .where(project_artifacts_table.c.project_id == project_id)
                .order_by(project_artifacts_table.c.created_at.desc())
            )
            rows = result.mappings().all()
        return [_serialize_artifact_row(row) for row in rows]

    async def create_project_artifact(
        self,
        *,
        project_id: str,
        session_id: str | None,
        kind: str,
        title: str,
        body_markdown: str,
        citation_manifest: list[dict[str, Any]] | None = None,
        artifact_id: str | None = None,
        created_at: datetime | None = None,
    ) -> dict[str, Any]:
        resolved_artifact_id = artifact_id or _generate_prefixed_id("artifact")
        timestamp = _coerce_datetime(created_at) or _now_utc()

        engine = await self._get_engine()
        async with engine.begin() as conn:
            await conn.execute(
                project_artifacts_table.insert().values(
                    id=resolved_artifact_id,
                    project_id=project_id,
                    session_id=session_id,
                    kind=kind,
                    title=title,
                    body_markdown=body_markdown,
                    citation_manifest_json=_dump_json(citation_manifest or []),
                    created_at=timestamp,
                )
            )
            await conn.execute(
                projects_table.update().where(projects_table.c.id == project_id).values(updated_at=timestamp)
            )
        return {
            "id": resolved_artifact_id,
            "project_id": project_id,
            "session_id": session_id,
            "kind": kind,
            "title": title,
            "body_markdown": body_markdown,
            "citation_manifest": citation_manifest or [],
            "created_at": timestamp,
        }

    async def get_project_tree(self, owner_id: str) -> list[dict[str, Any]]:
        projects = await self.list_projects(owner_id)
        result: list[dict[str, Any]] = []
        for project in projects:
            sessions = await self.list_sessions(project["id"], include_snapshots=True)
            project_copy = dict(project)
            project_copy["sessions"] = sessions
            result.append(project_copy)
        return result

    async def get_effective_collection_name(self, session_id: str) -> str | None:
        session = await self.get_session(session_id, include_snapshot=False)
        if session is None:
            return None
        return session["knowledge_collection_name"]

    async def get_project_for_session(self, session_id: str) -> dict[str, Any] | None:
        session = await self.get_session(session_id, include_snapshot=False)
        if session is None:
            return None
        return await self.get_project(session["project_id"])


_app_state_store: AppStateStore | None = None


def get_app_state_store() -> AppStateStore:
    global _app_state_store
    if _app_state_store is None:
        _app_state_store = AppStateStore()
    return _app_state_store
