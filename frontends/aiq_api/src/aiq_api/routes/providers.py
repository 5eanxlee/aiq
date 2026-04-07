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

"""Provider readiness and quota routes for the AI-Q API."""

from __future__ import annotations

import asyncio
import logging
import os
import time
from dataclasses import dataclass
from datetime import UTC
from datetime import datetime
from typing import TYPE_CHECKING
from typing import Any

import aiohttp
from fastapi import FastAPI
from pydantic import BaseModel
from pydantic import Field
from pydantic import SecretStr

from aiq_agent.common import RuntimeLLMObservation

if TYPE_CHECKING:
    from nat.builder.workflow_builder import WorkflowBuilder

logger = logging.getLogger(__name__)

_ACTIVE_FUNCTION_NAMES = (
    "intent_classifier",
    "clarifier_agent",
    "shallow_research_agent",
    "deep_research_agent",
)
_PROBE_CACHE_TTL_SECONDS = 60
_PROBE_TIMEOUT_SECONDS = 10
_RUNTIME_ACTIVITY_WINDOW_SECONDS = 6 * 60 * 60
_PROBE_CACHE: dict[tuple[str, int], tuple[float, "ProviderProbeResult"]] = {}
_PROBE_CACHE_LOCK = asyncio.Lock()
_WORKER_DISPLAY_NAMES = {
    "intent_classifier": "Intent Classifier",
    "clarifier_agent": "Clarifier",
    "shallow_research_agent": "Shallow Research",
    "deep_research_agent": "Deep Research",
}
_LLM_ROLE_DISPLAY_NAMES = {
    "llm": "Primary",
    "planner_llm": "Planner",
    "researcher_llm": "Researcher",
    "orchestrator_llm": "Orchestrator",
}


class ProviderQuotaResponse(BaseModel):
    """Quota or credit information for a provider."""

    supported: bool = Field(..., description="Whether quota/credit details are available for this provider.")
    has_credit: bool | None = Field(
        default=None,
        description="True when the provider reports remaining credits/quota, false when exhausted, null when unknown.",
    )
    remaining: float | None = Field(default=None, description="Remaining credits/quota when reported.")
    used: float | None = Field(default=None, description="Consumed credits/quota when reported.")
    limit: float | None = Field(default=None, description="Total quota limit when reported.")
    unit: str | None = Field(default=None, description="Display unit for quota values.")
    rate_limit: float | None = Field(default=None, description="Provider-reported rate limit when available.")
    message: str | None = Field(default=None, description="Human-readable quota summary.")


class RuntimeModelObservationResponse(BaseModel):
    """Observed model calls captured at runtime."""

    worker: str = Field(..., description="Worker that issued the model call.")
    model_name: str = Field(..., description="Model name observed at runtime.")
    provider_id: str | None = Field(default=None, description="Provider inferred from the runtime call.")
    endpoint: str | None = Field(default=None, description="Endpoint used for the runtime call when available.")
    temperature: float | None = Field(default=None, description="Observed temperature for the runtime call.")
    top_p: float | None = Field(default=None, description="Observed top-p for the runtime call.")
    max_tokens: int | None = Field(default=None, description="Observed max tokens for the runtime call.")
    first_seen_at: str = Field(..., description="First time this runtime call pattern was observed.")
    last_seen_at: str = Field(..., description="Most recent time this runtime call pattern was observed.")
    call_count: int = Field(..., description="Number of observed calls for this runtime pattern.")
    prompt_tokens: int | None = Field(default=None, description="Aggregated prompt tokens when available.")
    completion_tokens: int | None = Field(default=None, description="Aggregated completion tokens when available.")
    total_tokens: int | None = Field(default=None, description="Aggregated total tokens when available.")


class WorkerLLMConfigResponse(BaseModel):
    """Configured LLM settings for a worker."""

    role: str = Field(..., description="Worker role using this LLM, such as orchestrator or planner.")
    llm_ref: str = Field(..., description="Configured LLM reference name.")
    provider_id: str | None = Field(default=None, description="Provider inferred from the worker config.")
    model_name: str | None = Field(default=None, description="Configured model name.")
    endpoint: str | None = Field(default=None, description="Configured endpoint base URL.")
    temperature: float | None = Field(default=None, description="Configured temperature.")
    top_p: float | None = Field(default=None, description="Configured top-p.")
    max_tokens: int | None = Field(default=None, description="Configured max tokens.")


class WorkerStatusResponseItem(BaseModel):
    """Configured and runtime-observed model usage for a worker."""

    id: str = Field(..., description="Stable worker identifier.")
    name: str = Field(..., description="Display name.")
    llms: list[WorkerLLMConfigResponse] = Field(default_factory=list, description="Configured worker LLMs.")
    runtime_calls: list[RuntimeModelObservationResponse] = Field(
        default_factory=list,
        description="Runtime-observed model calls for this worker.",
    )
    last_runtime_at: str | None = Field(default=None, description="Last runtime observation for this worker.")


class ProviderStatusResponseItem(BaseModel):
    """Status for a configured or active provider."""

    id: str = Field(..., description="Stable provider identifier.")
    name: str = Field(..., description="Display name.")
    kind: str = Field(..., description="Provider category such as llm or search.")
    active: bool = Field(..., description="Whether the current workflow actively uses this provider.")
    configured: bool = Field(..., description="Whether this provider has sufficient configuration to be used.")
    connected: bool | None = Field(
        default=None,
        description="Whether a lightweight connectivity probe succeeded. Null when not probed.",
    )
    status: str = Field(
        ...,
        description="Readiness summary: ready, inactive, missing_config, error, or limited.",
    )
    detail: str | None = Field(default=None, description="Human-readable status detail.")
    features: list[str] = Field(default_factory=list, description="Capabilities used from this provider.")
    models: list[str] = Field(default_factory=list, description="Model names used from this provider, when applicable.")
    endpoints: list[str] = Field(default_factory=list, description="Base URLs used for this provider, when known.")
    runtime_calls: list[RuntimeModelObservationResponse] = Field(
        default_factory=list,
        description="Runtime-observed model calls associated with this provider.",
    )
    quota: ProviderQuotaResponse = Field(..., description="Quota or credit details.")


class ProviderDashboardResponse(BaseModel):
    """Aggregate provider readiness payload."""

    generated_at: str = Field(..., description="Timestamp when this provider snapshot was generated.")
    can_run_research: bool = Field(..., description="Whether the current workflow has the dependencies it needs.")
    missing_requirements: list[str] = Field(
        default_factory=list,
        description="Blocking issues preventing the current workflow from running research.",
    )
    runtime_window_minutes: int = Field(..., description="Time window used for runtime model observations.")
    providers: list[ProviderStatusResponseItem] = Field(default_factory=list, description="Provider statuses.")
    workers: list[WorkerStatusResponseItem] = Field(default_factory=list, description="Worker model status.")


@dataclass
class ProviderProbeResult:
    connected: bool | None
    detail: str | None
    quota: ProviderQuotaResponse
    status: str | None = None


def _provider_env_keys(provider_id: str) -> tuple[str, ...]:
    if provider_id == "nvidia":
        return ("NVIDIA_API_KEY", "NVIDIA_INFERENCE_API_KEY", "INFERENCE_NVIDIA_API_KEY")
    if provider_id == "openai":
        return ("OPENAI_API_KEY",)
    if provider_id == "tavily":
        return ("TAVILY_API_KEY",)
    if provider_id == "serper":
        return ("SERPER_API_KEY",)
    if provider_id == "semantic_scholar":
        return ("SEMANTIC_SCHOLAR_API_KEY",)
    return ()


def _empty_provider(provider_id: str, name: str, kind: str) -> dict[str, Any]:
    return {
        "id": provider_id,
        "name": name,
        "kind": kind,
        "active": False,
        "configured": False,
        "connected": None,
        "status": "inactive",
        "detail": None,
        "features": set(),
        "models": set(),
        "endpoints": set(),
        "llm_configs": [],
        "tool_configs": [],
        "quota": ProviderQuotaResponse(
            supported=False,
            message="Quota details are not available for this provider.",
        ),
    }


def _initial_provider_map() -> dict[str, dict[str, Any]]:
    return {
        "nvidia": _empty_provider("nvidia", "NVIDIA NIM", "llm"),
        "openai": _empty_provider("openai", "OpenAI", "llm"),
        "tavily": _empty_provider("tavily", "Tavily", "search"),
        "serper": _empty_provider("serper", "Serper", "search"),
        "semantic_scholar": _empty_provider("semantic_scholar", "Semantic Scholar", "search"),
    }


def _safe_model_dump(config: Any) -> dict[str, Any]:
    if config is None:
        return {}
    if hasattr(config, "model_dump"):
        return config.model_dump(exclude_none=True)
    return {}


def _secret_to_str(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, SecretStr):
        return value.get_secret_value()
    if hasattr(value, "get_secret_value"):
        return value.get_secret_value()
    value_str = str(value).strip()
    return value_str or None


def _get_first_env_value(keys: tuple[str, ...]) -> str | None:
    for key in keys:
        value = os.environ.get(key, "").strip()
        if value:
            return value
    return None


def _extract_base_url(config: Any) -> str | None:
    dump = _safe_model_dump(config)
    base_url = dump.get("base_url", getattr(config, "base_url", None))
    if base_url is None:
        return None
    base_url_str = str(base_url).strip()
    return base_url_str.rstrip("/") if base_url_str else None


def _extract_model_name(config: Any) -> str | None:
    dump = _safe_model_dump(config)
    model_name = dump.get("model_name", getattr(config, "model_name", None))
    if model_name is None:
        return None
    model_name_str = str(model_name).strip()
    return model_name_str or None


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


def _extract_llm_float(config: Any, key: str) -> float | None:
    dump = _safe_model_dump(config)
    return _coerce_float(dump.get(key, getattr(config, key, None)))


def _extract_llm_int(config: Any, key: str) -> int | None:
    dump = _safe_model_dump(config)
    return _coerce_int(dump.get(key, getattr(config, key, None)))


def _is_local_endpoint(base_url: str | None) -> bool:
    if not base_url:
        return False
    lowered = base_url.lower()
    return "localhost" in lowered or "127.0.0.1" in lowered or "0.0.0.0" in lowered


def _looks_like_openai_model(model_name: str) -> bool:
    lowered = model_name.lower()
    return lowered.startswith(("gpt-", "o1", "o3", "o4", "chatgpt", "omni", "text-embedding", "tts-"))


def _identify_llm_provider(llm_config: Any) -> str | None:
    type_name = type(llm_config).__name__.lower()
    model_name = (_extract_model_name(llm_config) or "").lower()
    base_url = (_extract_base_url(llm_config) or "").lower()

    if "integrate.api.nvidia.com" in base_url or model_name.startswith("nvidia/"):
        return "nvidia"
    if "nim" in type_name and "openai.com" not in base_url:
        return "nvidia"
    if model_name.startswith("openai/gpt-oss") or model_name.startswith("openai/"):
        return "nvidia" if "integrate.api.nvidia.com" in base_url else "openai"
    if "api.openai.com" in base_url or "openai" in type_name or _looks_like_openai_model(model_name):
        return "openai"
    return None


def _identify_tool_provider(tool_name: str, tool_config: Any) -> tuple[str | None, str | None]:
    name_lower = tool_name.lower()
    config_dump = _safe_model_dump(tool_config)
    config_type = type(tool_config).__name__.lower()

    if (
        "semantic_scholar" in config_type
        or ("semantic" in config_type and "scholar" in config_type)
        or hasattr(tool_config, "semantic_scholar_api_key")
        or "semantic_scholar_api_key" in config_dump
    ):
        return "semantic_scholar", "paper_search"

    if (
        "paper" in name_lower
        or "scholar" in name_lower
        or "serper" in config_type
        or "serper_api_key" in config_dump
    ):
        return "serper", "paper_search"

    if (
        ("web" in name_lower or "tavily" in name_lower)
        and "knowledge" not in name_lower
        and "document" not in name_lower
    ) or "tavily" in config_type:
        return "tavily", "web_search"

    return None, None


def _collect_provider_usage(builder: WorkflowBuilder) -> dict[str, dict[str, Any]]:
    providers = _initial_provider_map()

    for fn_name in _ACTIVE_FUNCTION_NAMES:
        try:
            fn_config = builder.get_function_config(fn_name)
        except (KeyError, ValueError):
            continue

        for llm_attr in ("llm", "planner_llm", "researcher_llm", "orchestrator_llm"):
            llm_ref = getattr(fn_config, llm_attr, None)
            if not llm_ref:
                continue

            try:
                llm_config = builder.get_llm_config(llm_ref)
            except (KeyError, ValueError):
                continue

            provider_id = _identify_llm_provider(llm_config)
            if not provider_id:
                continue

            provider = providers[provider_id]
            provider["active"] = True
            provider["features"].add("llm")
            provider["llm_configs"].append(llm_config)

            model_name = _extract_model_name(llm_config)
            if model_name:
                provider["models"].add(model_name)

            base_url = _extract_base_url(llm_config)
            if base_url:
                provider["endpoints"].add(base_url)

        for tool_ref in getattr(fn_config, "tools", None) or []:
            tool_name = str(tool_ref)
            try:
                tool_config = builder.get_function_config(tool_name)
            except (KeyError, ValueError):
                tool_config = None

            provider_id, feature = _identify_tool_provider(tool_name, tool_config)
            if not provider_id:
                continue

            provider = providers[provider_id]
            provider["active"] = True
            if feature:
                provider["features"].add(feature)
            provider["tool_configs"].append(tool_config)

    return providers


def _collect_worker_usage(builder: WorkflowBuilder) -> list[dict[str, Any]]:
    workers: list[dict[str, Any]] = []

    for fn_name in _ACTIVE_FUNCTION_NAMES:
        try:
            fn_config = builder.get_function_config(fn_name)
        except (KeyError, ValueError):
            continue

        worker = {
            "id": fn_name,
            "name": _WORKER_DISPLAY_NAMES.get(fn_name, fn_name.replace("_", " ").title()),
            "llms": [],
        }

        for llm_attr in ("llm", "planner_llm", "researcher_llm", "orchestrator_llm"):
            llm_ref = getattr(fn_config, llm_attr, None)
            if not llm_ref:
                continue

            try:
                llm_config = builder.get_llm_config(llm_ref)
            except (KeyError, ValueError):
                continue

            worker["llms"].append(
                WorkerLLMConfigResponse(
                    role=_LLM_ROLE_DISPLAY_NAMES.get(llm_attr, llm_attr),
                    llm_ref=str(llm_ref),
                    provider_id=_identify_llm_provider(llm_config),
                    model_name=_extract_model_name(llm_config),
                    endpoint=_extract_base_url(llm_config),
                    temperature=_extract_llm_float(llm_config, "temperature"),
                    top_p=_extract_llm_float(llm_config, "top_p"),
                    max_tokens=_extract_llm_int(llm_config, "max_tokens"),
                )
            )

        if worker["llms"]:
            workers.append(worker)

    return workers


def _serialize_runtime_observation(observation: RuntimeLLMObservation) -> RuntimeModelObservationResponse:
    return RuntimeModelObservationResponse(
        worker=observation.worker,
        model_name=observation.model_name,
        provider_id=observation.provider_id,
        endpoint=observation.endpoint,
        temperature=observation.temperature,
        top_p=observation.top_p,
        max_tokens=observation.max_tokens,
        first_seen_at=observation.first_seen_at,
        last_seen_at=observation.last_seen_at,
        call_count=observation.call_count,
        prompt_tokens=observation.prompt_tokens,
        completion_tokens=observation.completion_tokens,
        total_tokens=observation.total_tokens,
    )


def _build_worker_statuses(
    worker_configs: list[dict[str, Any]],
    runtime_observations: list[RuntimeLLMObservation],
) -> list[WorkerStatusResponseItem]:
    runtime_by_worker: dict[str, list[RuntimeLLMObservation]] = {}
    for observation in runtime_observations:
        runtime_by_worker.setdefault(observation.worker, []).append(observation)

    worker_statuses: list[WorkerStatusResponseItem] = []
    for worker in worker_configs:
        runtime_calls = sorted(
            runtime_by_worker.get(worker["id"], []),
            key=lambda observation: observation.last_seen_at,
            reverse=True,
        )
        worker_statuses.append(
            WorkerStatusResponseItem(
                id=worker["id"],
                name=worker["name"],
                llms=worker["llms"],
                runtime_calls=[_serialize_runtime_observation(observation) for observation in runtime_calls],
                last_runtime_at=runtime_calls[0].last_seen_at if runtime_calls else None,
            )
        )

    return worker_statuses


def _is_provider_configured(provider_id: str, provider: dict[str, Any]) -> bool:
    if _get_first_env_value(_provider_env_keys(provider_id)):
        return True

    if provider_id in {"nvidia", "openai"}:
        for llm_config in provider["llm_configs"]:
            api_key = _secret_to_str(getattr(llm_config, "api_key", None))
            if api_key:
                return True
            if _is_local_endpoint(_extract_base_url(llm_config)):
                return True
        return False

    if provider_id == "tavily":
        for tool_config in provider["tool_configs"]:
            api_key = _secret_to_str(getattr(tool_config, "api_key", None)) if tool_config else None
            if api_key:
                return True
        return False

    if provider_id == "serper":
        for tool_config in provider["tool_configs"]:
            api_key = _secret_to_str(getattr(tool_config, "serper_api_key", None)) if tool_config else None
            if api_key:
                return True
        return False

    if provider_id == "semantic_scholar":
        for tool_config in provider["tool_configs"]:
            if tool_config is not None:
                return True
        return False

    return False


def _get_provider_api_key(provider_id: str, provider: dict[str, Any]) -> str | None:
    env_value = _get_first_env_value(_provider_env_keys(provider_id))
    if env_value:
        return env_value

    if provider_id in {"nvidia", "openai"}:
        for llm_config in provider["llm_configs"]:
            api_key = _secret_to_str(getattr(llm_config, "api_key", None))
            if api_key:
                return api_key
    elif provider_id == "tavily":
        for tool_config in provider["tool_configs"]:
            api_key = _secret_to_str(getattr(tool_config, "api_key", None)) if tool_config else None
            if api_key:
                return api_key
    elif provider_id == "serper":
        for tool_config in provider["tool_configs"]:
            api_key = _secret_to_str(getattr(tool_config, "serper_api_key", None)) if tool_config else None
            if api_key:
                return api_key
    elif provider_id == "semantic_scholar":
        for tool_config in provider["tool_configs"]:
            api_key = (
                _secret_to_str(getattr(tool_config, "semantic_scholar_api_key", None)) if tool_config else None
            )
            if api_key:
                return api_key

    return None


def _base_provider_detail(provider_id: str, provider: dict[str, Any]) -> str | None:
    if provider["active"]:
        if provider_id == "serper":
            return "Current workflow uses Serper-backed paper search."
        if provider_id == "semantic_scholar":
            return "Current workflow uses Semantic Scholar-backed paper search."
        if provider_id == "tavily":
            return "Current workflow uses Tavily for web search."
        return "Current workflow actively uses this provider."

    if provider["configured"]:
        if provider_id == "serper":
            return "Configured, but the active workflow has not enabled paper_search_tool yet."
        if provider_id == "semantic_scholar":
            return "Configured, but the active workflow has not enabled Semantic Scholar paper search yet."
        return "Configured, but not enabled in the active workflow."

    return None


async def _probe_tavily(api_key: str) -> ProviderProbeResult:
    headers = {"Authorization": f"Bearer {api_key}"}
    timeout = aiohttp.ClientTimeout(total=_PROBE_TIMEOUT_SECONDS)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get("https://api.tavily.com/usage", headers=headers) as response:
            if response.status != 200:
                detail = f"Tavily usage probe failed with HTTP {response.status}."
                return ProviderProbeResult(
                    connected=False,
                    detail=detail,
                    quota=ProviderQuotaResponse(
                        supported=True,
                        message=detail,
                    ),
                )

            payload = await response.json()

    account = payload.get("account", {}) if isinstance(payload, dict) else {}
    key_payload = payload.get("key", {}) if isinstance(payload, dict) else {}
    used = account.get("plan_usage")
    limit = account.get("plan_limit")

    if used is None:
        used = key_payload.get("usage")
    if limit is None:
        limit = key_payload.get("limit")

    remaining = None
    if isinstance(limit, (int, float)) and isinstance(used, (int, float)):
        remaining = max(float(limit) - float(used), 0.0)

    plan_name = account.get("current_plan")
    quota_message = "Tavily usage retrieved."
    if isinstance(remaining, (int, float)):
        quota_message = f"{plan_name or 'Tavily'} has {remaining:.0f} credits remaining."
    elif isinstance(limit, (int, float)) and isinstance(used, (int, float)):
        quota_message = f"{plan_name or 'Tavily'} usage: {float(used):.0f}/{float(limit):.0f} credits."
    elif plan_name:
        quota_message = f"Tavily plan: {plan_name}."

    has_credit = remaining > 0 if remaining is not None else True

    return ProviderProbeResult(
        connected=True,
        detail=f"Tavily plan: {plan_name}." if plan_name else "Tavily connectivity verified.",
        quota=ProviderQuotaResponse(
            supported=True,
            has_credit=has_credit,
            remaining=float(remaining) if remaining is not None else None,
            used=float(used) if isinstance(used, (int, float)) else None,
            limit=float(limit) if isinstance(limit, (int, float)) else None,
            unit="credits",
            message=quota_message,
        ),
    )


async def _probe_serper(api_key: str) -> ProviderProbeResult:
    headers = {"X-API-KEY": api_key}
    timeout = aiohttp.ClientTimeout(total=_PROBE_TIMEOUT_SECONDS)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get("https://google.serper.dev/account", headers=headers) as response:
            if response.status != 200:
                detail = f"Serper account probe failed with HTTP {response.status}."
                return ProviderProbeResult(
                    connected=False,
                    detail=detail,
                    quota=ProviderQuotaResponse(
                        supported=True,
                        message=detail,
                    ),
                )

            payload = await response.json()

    balance = payload.get("balance") if isinstance(payload, dict) else None
    rate_limit = payload.get("rateLimit") if isinstance(payload, dict) else None
    has_credit = balance > 0 if isinstance(balance, (int, float)) else True
    message = (
        f"Serper balance: {float(balance):.0f} credits remaining."
        if isinstance(balance, (int, float))
        else "Serper account verified."
    )

    return ProviderProbeResult(
        connected=True,
        detail="Serper connectivity verified.",
        quota=ProviderQuotaResponse(
            supported=True,
            has_credit=has_credit,
            remaining=float(balance) if isinstance(balance, (int, float)) else None,
            unit="credits",
            rate_limit=float(rate_limit) if isinstance(rate_limit, (int, float)) else None,
            message=message,
        ),
    )


async def _probe_semantic_scholar(api_key: str | None) -> ProviderProbeResult:
    if not api_key:
        return ProviderProbeResult(
            connected=None,
            detail=(
                "Semantic Scholar is using unauthenticated access. The dashboard skips the live probe "
                "to avoid exhausting public rate limits."
            ),
            quota=ProviderQuotaResponse(
                supported=False,
                message="Semantic Scholar does not expose remaining quota or credits via API.",
            ),
            status="limited",
        )

    headers = {}
    headers["x-api-key"] = api_key

    timeout = aiohttp.ClientTimeout(total=_PROBE_TIMEOUT_SECONDS)
    params = {
        "query": "transformers",
        "limit": 1,
        "fields": "paperId,title",
    }
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(
            "https://api.semanticscholar.org/graph/v1/paper/search",
            headers=headers,
            params=params,
        ) as response:
            if response.status == 429:
                retry_after = response.headers.get("Retry-After")
                detail = "Semantic Scholar rate-limited the readiness probe (HTTP 429)."
                if retry_after:
                    detail = f"{detail} Retry after {retry_after} seconds."
                return ProviderProbeResult(
                    connected=None,
                    detail=detail,
                    quota=ProviderQuotaResponse(
                        supported=False,
                        message=detail,
                    ),
                    status="limited",
                )

            if response.status != 200:
                detail = f"Semantic Scholar connectivity probe failed with HTTP {response.status}."
                return ProviderProbeResult(
                    connected=False,
                    detail=detail,
                    quota=ProviderQuotaResponse(
                        supported=False,
                        message=detail,
                    ),
                )

    detail = (
        "Semantic Scholar connectivity verified with API key."
        if api_key
        else "Semantic Scholar connectivity verified without an API key."
    )
    return ProviderProbeResult(
        connected=True,
        detail=detail,
        quota=ProviderQuotaResponse(
            supported=False,
            message="Semantic Scholar does not expose remaining quota or credits via API.",
        ),
    )


async def _probe_openai(api_key: str) -> ProviderProbeResult:
    headers = {"Authorization": f"Bearer {api_key}"}
    timeout = aiohttp.ClientTimeout(total=_PROBE_TIMEOUT_SECONDS)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get("https://api.openai.com/v1/models", headers=headers) as response:
            if response.status != 200:
                detail = f"OpenAI connectivity probe failed with HTTP {response.status}."
                return ProviderProbeResult(
                    connected=False,
                    detail=detail,
                    quota=ProviderQuotaResponse(
                        supported=False,
                        message=detail,
                    ),
                )

    return ProviderProbeResult(
        connected=True,
        detail="OpenAI connectivity verified.",
        quota=ProviderQuotaResponse(
            supported=False,
            message="Quota details are unavailable for this key without organization usage access.",
        ),
    )


async def _probe_nvidia(api_key: str) -> ProviderProbeResult:
    headers = {"Authorization": f"Bearer {api_key}"}
    timeout = aiohttp.ClientTimeout(total=_PROBE_TIMEOUT_SECONDS)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get("https://integrate.api.nvidia.com/v1/models", headers=headers) as response:
            if response.status != 200:
                detail = f"NVIDIA connectivity probe failed with HTTP {response.status}."
                return ProviderProbeResult(
                    connected=False,
                    detail=detail,
                    quota=ProviderQuotaResponse(
                        supported=False,
                        message=detail,
                    ),
                )

    return ProviderProbeResult(
        connected=True,
        detail="NVIDIA connectivity verified.",
        quota=ProviderQuotaResponse(
            supported=False,
            message="Remaining credits are not exposed by the NVIDIA model endpoint.",
        ),
    )


async def _probe_with_cache(provider_id: str, api_key: str | None, probe_fn: Any) -> ProviderProbeResult:
    cache_key = (provider_id, hash(api_key or ""))
    cached = _PROBE_CACHE.get(cache_key)
    now = time.monotonic()
    if cached and now - cached[0] < _PROBE_CACHE_TTL_SECONDS:
        return cached[1]

    result = await probe_fn(api_key)
    async with _PROBE_CACHE_LOCK:
        _PROBE_CACHE[cache_key] = (time.monotonic(), result)
    return result


async def _probe_provider(provider_id: str, provider: dict[str, Any]) -> ProviderProbeResult:
    api_key = _get_provider_api_key(provider_id, provider)
    endpoints = sorted(provider["endpoints"])

    if provider_id == "semantic_scholar" and provider["configured"]:
        return await _probe_with_cache(provider_id, api_key, _probe_semantic_scholar)

    if not api_key:
        if any(_is_local_endpoint(endpoint) for endpoint in endpoints):
            return ProviderProbeResult(
                connected=True,
                detail="Using a local endpoint; remote quota probing is not available.",
                quota=ProviderQuotaResponse(
                    supported=False,
                    message="Local endpoints do not expose centralized quota information.",
                ),
            )

        return ProviderProbeResult(
            connected=None,
            detail=None,
            quota=ProviderQuotaResponse(
                supported=False,
                message="Provider is not configured.",
            ),
        )

    if provider_id == "tavily":
        return await _probe_with_cache(provider_id, api_key, _probe_tavily)
    if provider_id == "serper":
        return await _probe_with_cache(provider_id, api_key, _probe_serper)
    if provider_id == "semantic_scholar":
        return await _probe_with_cache(provider_id, api_key, _probe_semantic_scholar)
    if provider_id == "openai":
        return await _probe_with_cache(provider_id, api_key, _probe_openai)
    if provider_id == "nvidia":
        return await _probe_with_cache(provider_id, api_key, _probe_nvidia)

    return ProviderProbeResult(
        connected=None,
        detail=None,
        quota=ProviderQuotaResponse(
            supported=False,
            message="No provider probe is available.",
        ),
    )


def _build_provider_status(
    provider_id: str,
    provider: dict[str, Any],
    probe: ProviderProbeResult,
    runtime_calls: list[RuntimeLLMObservation] | None = None,
) -> ProviderStatusResponseItem:
    active = bool(provider["active"])
    configured = bool(provider["configured"])
    base_detail = _base_provider_detail(provider_id, provider)
    detail = (probe.detail or base_detail) if active else (base_detail or probe.detail)

    if active and not configured:
        status = "missing_config"
        detail = detail or "Required by the active workflow but not configured."
    elif active and probe.status == "limited":
        status = "limited"
        detail = detail or "Configured, but the provider is temporarily rate limited."
    elif active and probe.connected is False:
        status = "error"
        detail = detail or "Configured, but the provider probe failed."
    elif active:
        status = "ready"
        detail = detail or "Ready."
    elif configured:
        status = "inactive"
        detail = detail or "Configured, but inactive."
    else:
        status = "inactive"

    return ProviderStatusResponseItem(
        id=provider_id,
        name=provider["name"],
        kind=provider["kind"],
        active=active,
        configured=configured,
        connected=probe.connected,
        status=status,
        detail=detail,
        features=sorted(provider["features"]),
        models=sorted(provider["models"]),
        endpoints=sorted(provider["endpoints"]),
        runtime_calls=[
            _serialize_runtime_observation(observation)
            for observation in sorted(
                runtime_calls or [],
                key=lambda observation: observation.last_seen_at,
                reverse=True,
            )
        ],
        quota=probe.quota,
    )


def _compute_missing_requirements(providers: list[ProviderStatusResponseItem]) -> list[str]:
    missing: list[str] = []

    active_llm_count = sum(1 for provider in providers if provider.active and "llm" in provider.features)
    active_search_count = sum(1 for provider in providers if provider.active and provider.kind == "search")

    if active_llm_count == 0:
        missing.append("No active LLM provider is configured for the current workflow.")
    if active_search_count == 0:
        missing.append("No active search provider is configured for the current workflow.")

    for provider in providers:
        if not provider.active:
            continue

        if not provider.configured:
            missing.append(f"{provider.name} is required by the active workflow but is not configured.")
            continue

        if provider.connected is False:
            missing.append(f"{provider.name} is configured but the readiness probe failed.")
            continue

        if provider.quota.supported and provider.quota.has_credit is False:
            missing.append(f"{provider.name} reports no remaining {provider.quota.unit or 'quota'}.")

    return missing


async def register_provider_routes(app: FastAPI, builder: WorkflowBuilder) -> None:
    """Register provider readiness routes."""

    @app.get(
        "/v1/providers/status",
        response_model=ProviderDashboardResponse,
        tags=["providers"],
        summary="Get provider readiness and quota status",
    )
    async def get_provider_status() -> ProviderDashboardResponse:
        from aiq_agent.common import get_runtime_model_activity

        provider_map = _collect_provider_usage(builder)
        worker_configs = _collect_worker_usage(builder)
        runtime_observations = get_runtime_model_activity(window_seconds=_RUNTIME_ACTIVITY_WINDOW_SECONDS)
        runtime_by_provider: dict[str, list[RuntimeLLMObservation]] = {}
        for observation in runtime_observations:
            if observation.provider_id:
                runtime_by_provider.setdefault(observation.provider_id, []).append(observation)

        for provider_id, provider in provider_map.items():
            provider["configured"] = _is_provider_configured(provider_id, provider)

        visible_provider_ids = [
            provider_id
            for provider_id, provider in provider_map.items()
            if provider["active"] or provider["configured"]
        ]

        probe_results = await asyncio.gather(
            *[_probe_provider(provider_id, provider_map[provider_id]) for provider_id in visible_provider_ids]
        )

        providers = [
            _build_provider_status(
                provider_id,
                provider_map[provider_id],
                probe,
                runtime_calls=runtime_by_provider.get(provider_id, []),
            )
            for provider_id, probe in zip(visible_provider_ids, probe_results, strict=False)
        ]
        providers.sort(key=lambda provider: (not provider.active, provider.kind, provider.name))
        workers = _build_worker_statuses(worker_configs, runtime_observations)

        missing_requirements = _compute_missing_requirements(providers)

        return ProviderDashboardResponse(
            generated_at=datetime.now(UTC).isoformat(),
            can_run_research=len(missing_requirements) == 0,
            missing_requirements=missing_requirements,
            runtime_window_minutes=_RUNTIME_ACTIVITY_WINDOW_SECONDS // 60,
            providers=providers,
            workers=workers,
        )

    logger.info("Registered /v1/providers/status route")
