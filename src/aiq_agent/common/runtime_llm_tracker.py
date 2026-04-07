from __future__ import annotations

import logging
import os
import sqlite3
import threading
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from langchain_core.callbacks import BaseCallbackHandler

logger = logging.getLogger(__name__)

_DB_LOCK = threading.Lock()
_DB_INITIALIZED_PATHS: set[str] = set()
_DEFAULT_WINDOW_SECONDS = 6 * 60 * 60


@dataclass(slots=True)
class RuntimeLLMObservation:
    worker: str
    provider_id: str | None
    model_name: str
    endpoint: str | None
    temperature: float | None
    top_p: float | None
    max_tokens: int | None
    first_seen_at: str
    last_seen_at: str
    call_count: int
    prompt_tokens: int | None
    completion_tokens: int | None
    total_tokens: int | None


def _find_project_root() -> Path:
    current = Path(__file__).resolve()
    for parent in current.parents:
        if (parent / "configs").exists() and (parent / "frontends").exists():
            return parent
    return Path.cwd()


def _tracker_db_path() -> Path:
    override = os.environ.get("AIQ_RUNTIME_LLM_TRACKER_DB", "").strip()
    if override:
        return Path(override).expanduser()
    return _find_project_root() / "var" / "runtime_llm_activity.sqlite3"


def _connect() -> sqlite3.Connection:
    path = _tracker_db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path_key = str(path.resolve())

    conn = sqlite3.connect(path, timeout=30, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")

    if path_key not in _DB_INITIALIZED_PATHS:
        with _DB_LOCK:
            if path_key not in _DB_INITIALIZED_PATHS:
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS llm_call_activity (
                        call_id TEXT PRIMARY KEY,
                        run_id TEXT,
                        parent_run_id TEXT,
                        worker TEXT NOT NULL,
                        call_type TEXT NOT NULL,
                        provider_id TEXT,
                        model_name TEXT,
                        endpoint TEXT,
                        temperature REAL,
                        top_p REAL,
                        max_tokens INTEGER,
                        prompt_count INTEGER,
                        message_count INTEGER,
                        started_at TEXT NOT NULL,
                        ended_at TEXT,
                        prompt_tokens INTEGER,
                        completion_tokens INTEGER,
                        total_tokens INTEGER,
                        status TEXT NOT NULL DEFAULT 'started'
                    )
                    """
                )
                conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_llm_call_activity_started_at "
                    "ON llm_call_activity(started_at DESC)"
                )
                conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_llm_call_activity_worker "
                    "ON llm_call_activity(worker, started_at DESC)"
                )
                conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_llm_call_activity_provider "
                    "ON llm_call_activity(provider_id, started_at DESC)"
                )
                conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_llm_call_activity_run_id "
                    "ON llm_call_activity(run_id)"
                )
                _DB_INITIALIZED_PATHS.add(path_key)

    return conn


def _iso_now() -> str:
    from datetime import UTC
    from datetime import datetime

    return datetime.now(UTC).isoformat()


def _coerce_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _coerce_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _extract_serialized_kwargs(serialized: dict[str, Any] | None) -> dict[str, Any]:
    if not serialized:
        return {}
    kwargs = serialized.get("kwargs")
    return kwargs if isinstance(kwargs, dict) else {}


def _extract_model_name(serialized: dict[str, Any] | None) -> str:
    kwargs = _extract_serialized_kwargs(serialized)
    model_name = kwargs.get("model") or kwargs.get("model_name")
    if isinstance(model_name, str) and model_name.strip():
        return model_name.strip()

    if serialized:
        name = serialized.get("name")
        if isinstance(name, str) and name.strip():
            return name.strip()

        serialized_id = serialized.get("id")
        if isinstance(serialized_id, list) and serialized_id:
            last = serialized_id[-1]
            if isinstance(last, str) and last.strip():
                return last.strip()

    return "unknown"


def _extract_endpoint(serialized: dict[str, Any] | None) -> str | None:
    kwargs = _extract_serialized_kwargs(serialized)
    for key in ("base_url", "openai_api_base", "api_base", "nvidia_api_base"):
        value = kwargs.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip().rstrip("/")
    return None


def _infer_provider_id(model_name: str, endpoint: str | None) -> str | None:
    lowered_model = model_name.lower()
    lowered_endpoint = (endpoint or "").lower()

    if "integrate.api.nvidia.com" in lowered_endpoint or lowered_model.startswith("nvidia/"):
        return "nvidia"
    if lowered_model.startswith("openai/"):
        return "nvidia" if "integrate.api.nvidia.com" in lowered_endpoint else "openai"
    if "api.openai.com" in lowered_endpoint or lowered_model.startswith(
        ("gpt-", "o1", "o3", "o4", "chatgpt", "omni")
    ):
        return "openai"
    return None


def _extract_usage(response: Any) -> tuple[int | None, int | None, int | None, str | None]:
    try:
        generation = response.generations[0][0]
    except (AttributeError, IndexError, TypeError):
        return None, None, None, None

    message = getattr(generation, "message", None)
    metadata = getattr(message, "response_metadata", {}) if message is not None else {}
    if not isinstance(metadata, dict):
        metadata = {}

    usage = metadata.get("token_usage")
    if not isinstance(usage, dict):
        usage = {}

    prompt_tokens = _coerce_int(usage.get("prompt_tokens") or usage.get("input_tokens"))
    completion_tokens = _coerce_int(usage.get("completion_tokens") or usage.get("output_tokens"))
    total_tokens = _coerce_int(usage.get("total_tokens"))

    if total_tokens is None and (prompt_tokens is not None or completion_tokens is not None):
        total_tokens = (prompt_tokens or 0) + (completion_tokens or 0)

    model_name = metadata.get("model_name")
    if isinstance(model_name, str) and model_name.strip():
        return prompt_tokens, completion_tokens, total_tokens, model_name.strip()

    return prompt_tokens, completion_tokens, total_tokens, None


def record_llm_start(
    *,
    worker: str,
    call_type: str,
    run_id: str | None,
    parent_run_id: str | None,
    serialized: dict[str, Any] | None,
    prompt_count: int | None = None,
    message_count: int | None = None,
) -> str:
    call_id = run_id or str(uuid.uuid4())
    model_name = _extract_model_name(serialized)
    endpoint = _extract_endpoint(serialized)
    kwargs = _extract_serialized_kwargs(serialized)

    provider_id = _infer_provider_id(model_name, endpoint)
    temperature = _coerce_float(kwargs.get("temperature"))
    top_p = _coerce_float(kwargs.get("top_p"))
    max_tokens = _coerce_int(kwargs.get("max_tokens") or kwargs.get("max_output_tokens"))
    started_at = _iso_now()

    try:
        with _connect() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO llm_call_activity (
                    call_id,
                    run_id,
                    parent_run_id,
                    worker,
                    call_type,
                    provider_id,
                    model_name,
                    endpoint,
                    temperature,
                    top_p,
                    max_tokens,
                    prompt_count,
                    message_count,
                    started_at,
                    status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    call_id,
                    run_id,
                    parent_run_id,
                    worker,
                    call_type,
                    provider_id,
                    model_name,
                    endpoint,
                    temperature,
                    top_p,
                    max_tokens,
                    prompt_count,
                    message_count,
                    started_at,
                    "started",
                ),
            )
    except sqlite3.Error:
        logger.exception("Failed to record LLM start for %s", worker)

    return call_id


def record_llm_end(*, run_id: str | None, call_id: str | None, response: Any) -> None:
    if not run_id and not call_id:
        return

    prompt_tokens, completion_tokens, total_tokens, response_model_name = _extract_usage(response)
    ended_at = _iso_now()

    where_clause = "call_id = ?" if call_id else "run_id = ?"
    where_value = call_id or run_id

    try:
        with _connect() as conn:
            existing = conn.execute(
                f"SELECT model_name, endpoint FROM llm_call_activity WHERE {where_clause}",
                (where_value,),
            ).fetchone()

            model_name = response_model_name or (existing["model_name"] if existing else None)
            endpoint = existing["endpoint"] if existing else None
            provider_id = _infer_provider_id(model_name or "unknown", endpoint)

            conn.execute(
                f"""
                UPDATE llm_call_activity
                SET ended_at = ?,
                    prompt_tokens = COALESCE(?, prompt_tokens),
                    completion_tokens = COALESCE(?, completion_tokens),
                    total_tokens = COALESCE(?, total_tokens),
                    model_name = COALESCE(?, model_name),
                    provider_id = COALESCE(?, provider_id),
                    status = ?
                WHERE {where_clause}
                """,
                (
                    ended_at,
                    prompt_tokens,
                    completion_tokens,
                    total_tokens,
                    model_name,
                    provider_id,
                    "completed",
                    where_value,
                ),
            )
    except sqlite3.Error:
        logger.exception("Failed to record LLM end for run_id=%s call_id=%s", run_id, call_id)


def record_llm_error(*, run_id: str | None, call_id: str | None) -> None:
    if not run_id and not call_id:
        return

    where_clause = "call_id = ?" if call_id else "run_id = ?"
    where_value = call_id or run_id

    try:
        with _connect() as conn:
            conn.execute(
                f"UPDATE llm_call_activity SET ended_at = ?, status = ? WHERE {where_clause}",
                (_iso_now(), "error", where_value),
            )
    except sqlite3.Error:
        logger.exception("Failed to record LLM error for run_id=%s call_id=%s", run_id, call_id)


def get_runtime_model_activity(window_seconds: int | None = None) -> list[RuntimeLLMObservation]:
    path = _tracker_db_path()
    if not path.exists():
        return []

    min_started_at = None
    if window_seconds is None:
        window_seconds = _DEFAULT_WINDOW_SECONDS
    if window_seconds > 0:
        from datetime import UTC
        from datetime import datetime, timedelta

        min_started_at = (datetime.now(UTC) - timedelta(seconds=window_seconds)).isoformat()

    query = """
        SELECT
            worker,
            provider_id,
            COALESCE(model_name, 'unknown') AS model_name,
            endpoint,
            temperature,
            top_p,
            max_tokens,
            MIN(started_at) AS first_seen_at,
            MAX(COALESCE(ended_at, started_at)) AS last_seen_at,
            COUNT(*) AS call_count,
            SUM(prompt_tokens) AS prompt_tokens,
            SUM(completion_tokens) AS completion_tokens,
            SUM(total_tokens) AS total_tokens
        FROM llm_call_activity
    """
    params: tuple[Any, ...] = ()
    if min_started_at:
        query += " WHERE started_at >= ?"
        params = (min_started_at,)
    query += """
        GROUP BY
            worker,
            provider_id,
            model_name,
            endpoint,
            temperature,
            top_p,
            max_tokens
        ORDER BY last_seen_at DESC, worker ASC
    """

    try:
        with _connect() as conn:
            rows = conn.execute(query, params).fetchall()
    except sqlite3.Error:
        logger.exception("Failed to read runtime LLM activity")
        return []

    return [
        RuntimeLLMObservation(
            worker=str(row["worker"]),
            provider_id=str(row["provider_id"]) if row["provider_id"] else None,
            model_name=str(row["model_name"]),
            endpoint=str(row["endpoint"]) if row["endpoint"] else None,
            temperature=_coerce_float(row["temperature"]),
            top_p=_coerce_float(row["top_p"]),
            max_tokens=_coerce_int(row["max_tokens"]),
            first_seen_at=str(row["first_seen_at"]),
            last_seen_at=str(row["last_seen_at"]),
            call_count=int(row["call_count"]),
            prompt_tokens=_coerce_int(row["prompt_tokens"]),
            completion_tokens=_coerce_int(row["completion_tokens"]),
            total_tokens=_coerce_int(row["total_tokens"]),
        )
        for row in rows
    ]


class RuntimeLLMTrackerCallback(BaseCallbackHandler):
    def __init__(self, worker: str):
        self.worker = worker
        self._run_to_call_id: dict[str, str] = {}

    def _handle_start(
        self,
        *,
        call_type: str,
        serialized: dict[str, Any] | None,
        run_id: str | None,
        parent_run_id: str | None,
        prompt_count: int | None = None,
        message_count: int | None = None,
    ) -> None:
        try:
            call_id = record_llm_start(
                worker=self.worker,
                call_type=call_type,
                run_id=run_id,
                parent_run_id=parent_run_id,
                serialized=serialized,
                prompt_count=prompt_count,
                message_count=message_count,
            )
            if run_id:
                self._run_to_call_id[run_id] = call_id
        except Exception:
            logger.exception("Runtime LLM tracking start failed for %s", self.worker)

    def on_llm_start(self, serialized: dict[str, Any], prompts: list[str], **kwargs: Any) -> None:
        run_id = str(kwargs.get("run_id", "")) or None
        parent_run_id = str(kwargs.get("parent_run_id", "")) or None
        self._handle_start(
            call_type="llm",
            serialized=serialized,
            run_id=run_id,
            parent_run_id=parent_run_id,
            prompt_count=len(prompts) if prompts else 0,
        )

    def on_chat_model_start(self, serialized: dict[str, Any], messages: list[Any], **kwargs: Any) -> None:
        run_id = str(kwargs.get("run_id", "")) or None
        parent_run_id = str(kwargs.get("parent_run_id", "")) or None
        self._handle_start(
            call_type="chat_model",
            serialized=serialized,
            run_id=run_id,
            parent_run_id=parent_run_id,
            message_count=len(messages) if messages else 0,
        )

    def on_llm_end(self, response: Any, **kwargs: Any) -> None:
        run_id = str(kwargs.get("run_id", "")) or None
        call_id = self._run_to_call_id.pop(run_id, None) if run_id else None
        try:
            record_llm_end(run_id=run_id, call_id=call_id, response=response)
        except Exception:
            logger.exception("Runtime LLM tracking end failed for %s", self.worker)

    def on_llm_error(self, error: BaseException, **kwargs: Any) -> None:
        del error
        run_id = str(kwargs.get("run_id", "")) or None
        call_id = self._run_to_call_id.pop(run_id, None) if run_id else None
        try:
            record_llm_error(run_id=run_id, call_id=call_id)
        except Exception:
            logger.exception("Runtime LLM tracking error failed for %s", self.worker)
