# SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Tests for provider route helper logic."""

import pytest

from aiq_api.routes import providers as provider_routes
from aiq_api.routes.providers import ProviderProbeResult
from aiq_api.routes.providers import ProviderQuotaResponse
from aiq_api.routes.providers import WorkerLLMConfigResponse
from aiq_api.routes.providers import _build_worker_statuses
from aiq_api.routes.providers import ProviderStatusResponseItem
from aiq_api.routes.providers import _build_provider_status
from aiq_api.routes.providers import _compute_missing_requirements
from aiq_api.routes.providers import _identify_tool_provider
from aiq_api.routes.providers import _is_provider_configured
from aiq_api.routes.providers import _probe_semantic_scholar
from aiq_agent.common.runtime_llm_tracker import RuntimeLLMObservation


class SemanticScholarSearchConfig:
    """Minimal stand-in for Semantic Scholar tool config."""

    semantic_scholar_api_key = None

    def model_dump(self, exclude_none: bool = True) -> dict[str, str]:
        del exclude_none
        return {"max_results": 5}


class PaperSearchToolConfig:
    """Minimal stand-in for Serper paper-search config."""

    serper_api_key = None

    def model_dump(self, exclude_none: bool = True) -> dict[str, str]:
        del exclude_none
        return {"max_results": 5}


def test_identify_tool_provider_prefers_semantic_scholar_config():
    provider_id, feature = _identify_tool_provider("paper_search_tool", SemanticScholarSearchConfig())

    assert provider_id == "semantic_scholar"
    assert feature == "paper_search"


def test_identify_tool_provider_detects_serper_config():
    provider_id, feature = _identify_tool_provider("paper_search_tool", PaperSearchToolConfig())

    assert provider_id == "serper"
    assert feature == "paper_search"


def test_semantic_scholar_is_configured_without_api_key_when_tool_exists():
    provider = {
        "tool_configs": [SemanticScholarSearchConfig()],
        "llm_configs": [],
    }

    assert _is_provider_configured("semantic_scholar", provider) is True


@pytest.mark.asyncio
async def test_probe_semantic_scholar_skips_live_probe_without_api_key(monkeypatch):
    class UnexpectedSession:
        def __init__(self, *args, **kwargs):
            del args, kwargs
            raise AssertionError("ClientSession should not be created without an API key")

    monkeypatch.setattr(provider_routes.aiohttp, "ClientSession", UnexpectedSession)

    result = await _probe_semantic_scholar(None)

    assert result.connected is None
    assert result.status == "limited"
    assert "skips the live probe" in (result.detail or "")


@pytest.mark.asyncio
async def test_probe_semantic_scholar_maps_http_429_to_limited(monkeypatch):
    class FakeResponse:
        status = 429
        headers = {"Retry-After": "120"}

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            del exc_type, exc, tb
            return False

    class FakeSession:
        def __init__(self, *args, **kwargs):
            del args, kwargs

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            del exc_type, exc, tb
            return False

        def get(self, *args, **kwargs):
            del args, kwargs
            return FakeResponse()

    monkeypatch.setattr(provider_routes.aiohttp, "ClientSession", FakeSession)

    result = await _probe_semantic_scholar("test-key")

    assert result.connected is None
    assert result.status == "limited"
    assert "HTTP 429" in (result.detail or "")
    assert "120" in (result.detail or "")


def test_build_provider_status_marks_active_limited_probe_as_limited():
    provider = {
        "name": "Semantic Scholar",
        "kind": "search",
        "active": True,
        "configured": True,
        "features": {"paper_search"},
        "models": set(),
        "endpoints": set(),
    }
    probe = ProviderProbeResult(
        connected=None,
        detail="Semantic Scholar rate-limited the readiness probe (HTTP 429).",
        quota=ProviderQuotaResponse(
            supported=False,
            message="Semantic Scholar rate-limited the readiness probe (HTTP 429).",
        ),
        status="limited",
    )

    status = _build_provider_status("semantic_scholar", provider, probe)

    assert status.status == "limited"


def test_limited_provider_does_not_block_research_readiness():
    providers = [
        ProviderStatusResponseItem(
            id="openai",
            name="OpenAI",
            kind="llm",
            active=True,
            configured=True,
            connected=True,
            status="ready",
            detail="OpenAI connectivity verified.",
            features=["llm"],
            models=["gpt-5.4"],
            endpoints=["https://api.openai.com"],
            runtime_calls=[],
            quota=ProviderQuotaResponse(
                supported=False,
                message="Quota details are unavailable for this key without organization usage access.",
            ),
        ),
        ProviderStatusResponseItem(
            id="semantic_scholar",
            name="Semantic Scholar",
            kind="search",
            active=True,
            configured=True,
            connected=None,
            status="limited",
            detail="Semantic Scholar is using unauthenticated access. The dashboard skips the live probe to avoid exhausting public rate limits.",
            features=["paper_search"],
            models=[],
            endpoints=[],
            runtime_calls=[],
            quota=ProviderQuotaResponse(
                supported=False,
                message="Semantic Scholar does not expose remaining quota or credits via API.",
            ),
        ),
    ]

    assert _compute_missing_requirements(providers) == []


def test_build_worker_statuses_includes_runtime_observations():
    worker_configs = [
        {
            "id": "deep_research_agent",
            "name": "Deep Research",
            "llms": [
                WorkerLLMConfigResponse(
                    role="Orchestrator",
                    llm_ref="gpt_oss_llm",
                    provider_id="nvidia",
                    model_name="openai/gpt-oss-120b",
                    endpoint="https://integrate.api.nvidia.com/v1",
                    temperature=1.0,
                    top_p=1.0,
                    max_tokens=256000,
                )
            ],
        }
    ]
    runtime_observations = [
        RuntimeLLMObservation(
            worker="deep_research_agent",
            provider_id="nvidia",
            model_name="openai/gpt-oss-120b",
            endpoint="https://integrate.api.nvidia.com/v1",
            temperature=1.0,
            top_p=1.0,
            max_tokens=256000,
            first_seen_at="2026-04-07T00:55:00Z",
            last_seen_at="2026-04-07T01:00:00Z",
            call_count=2,
            prompt_tokens=100,
            completion_tokens=50,
            total_tokens=150,
        )
    ]

    workers = _build_worker_statuses(worker_configs, runtime_observations)

    assert len(workers) == 1
    assert workers[0].id == "deep_research_agent"
    assert workers[0].runtime_calls[0].model_name == "openai/gpt-oss-120b"
    assert workers[0].last_runtime_at == "2026-04-07T01:00:00Z"
