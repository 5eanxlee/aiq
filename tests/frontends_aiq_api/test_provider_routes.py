# SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Tests for provider route helper logic."""

import pytest

from aiq_api.routes import providers as provider_routes
from aiq_api.routes.providers import ProviderProbeResult
from aiq_api.routes.providers import ProviderQuotaResponse
from aiq_api.routes.providers import WorkerLLMConfigResponse
from aiq_api.routes.providers import _build_worker_statuses
from aiq_api.routes.providers import _config_supports_front_end
from aiq_api.routes.providers import ProviderStatusResponseItem
from aiq_api.routes.providers import _build_provider_status
from aiq_api.routes.providers import _build_config_runtime
from aiq_api.routes.providers import _compute_missing_requirements
from aiq_api.routes.providers import _coerce_probe_result
from aiq_api.routes.providers import _identify_tool_provider
from aiq_api.routes.providers import _is_provider_configured
from aiq_api.routes.providers import _list_config_presets
from aiq_api.routes.providers import _probe_with_cache
from aiq_api.routes.providers import _probe_semantic_scholar
from aiq_api.routes.providers import _resolve_preset_config
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


@pytest.mark.asyncio
async def test_probe_with_cache_returns_soft_failure_on_probe_exception():
    provider_routes._PROBE_CACHE.clear()

    async def failing_probe(_api_key: str | None) -> ProviderProbeResult:
        del _api_key
        raise RuntimeError("dns resolution failed")

    result = await _probe_with_cache("nvidia", "test-key", failing_probe)

    assert result.connected is False
    assert "NVIDIA NIM connectivity probe failed" in (result.detail or "")
    assert "dns resolution failed" in (result.detail or "")
    assert result.quota.message == result.detail


def test_coerce_probe_result_returns_soft_failure_for_escaped_exception():
    escaped_error = RuntimeError("dns resolution failed")

    result = _coerce_probe_result("tavily", escaped_error)

    assert result.connected is False
    assert "Tavily connectivity probe failed" in (result.detail or "")
    assert "dns resolution failed" in (result.detail or "")


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


def test_list_config_presets_marks_current_and_recommended(tmp_path, monkeypatch):
    configs_dir = tmp_path / "configs"
    configs_dir.mkdir()
    current_preset = configs_dir / "config_preset_current_setup.yml"
    current_preset.write_text(
        "# Preset: current setup\n# - Mirrors the current local setup.\ngeneral:\n  front_end:\n    _type: fastapi\nworkflow:\n  _type: chat_deepresearcher_agent\n",
        encoding="utf-8",
    )
    max_preset = configs_dir / "config_preset_max_quality.yml"
    max_preset.write_text(
        "# Preset: max quality\n# - Highest quality preset.\ngeneral:\n  front_end:\n    _type: fastapi\nworkflow:\n  _type: chat_deepresearcher_agent\n",
        encoding="utf-8",
    )
    repo_config = configs_dir / "config_frontier_models.yml"
    repo_config.write_text(
        "# This is an example frontier config.\ngeneral:\n  front_end:\n    _type: fastapi\nworkflow:\n  _type: chat_deepresearcher_agent\n",
        encoding="utf-8",
    )
    cli_only_config = configs_dir / "config_cli_default.yml"
    cli_only_config.write_text(
        "# CLI only config.\nworkflow:\n  _type: chat_deepresearcher_agent\n",
        encoding="utf-8",
    )

    monkeypatch.setattr(provider_routes, "_PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(provider_routes, "_CONFIGS_DIR", configs_dir)

    presets = _list_config_presets("configs/config_preset_current_setup.yml")

    assert [preset.config_path for preset in presets] == [
        "configs/config_preset_current_setup.yml",
        "configs/config_preset_max_quality.yml",
        "configs/config_frontier_models.yml",
    ]
    assert presets[0].current is True
    assert presets[1].recommended is True
    assert presets[2].kind == "repo_config"


def test_config_supports_front_end_detects_web_enabled_configs(tmp_path):
    web_config = tmp_path / "config_web_default_llamaindex.yml"
    web_config.write_text("general:\n  front_end:\n    _type: fastapi\n", encoding="utf-8")
    cli_config = tmp_path / "config_cli_default.yml"
    cli_config.write_text("general:\n  telemetry:\n    logging: false\n", encoding="utf-8")

    assert _config_supports_front_end(web_config) is True
    assert _config_supports_front_end(cli_config) is False


def test_resolve_preset_config_accepts_repo_web_configs_and_rejects_cli_only(tmp_path, monkeypatch):
    configs_dir = tmp_path / "configs"
    configs_dir.mkdir()
    web_config = configs_dir / "config_frontier_models.yml"
    web_config.write_text("general:\n  front_end:\n    _type: fastapi\n", encoding="utf-8")
    cli_config = configs_dir / "config_cli_default.yml"
    cli_config.write_text("general:\n  telemetry:\n    logging: false\n", encoding="utf-8")

    monkeypatch.setattr(provider_routes, "_PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(provider_routes, "_CONFIGS_DIR", configs_dir)

    assert _resolve_preset_config("configs/config_frontier_models.yml") == "configs/config_frontier_models.yml"

    with pytest.raises(provider_routes.HTTPException) as exc_info:
        _resolve_preset_config("configs/config_cli_default.yml")

    assert "does not define front_end" in exc_info.value.detail


def test_build_config_runtime_uses_local_stack_state(tmp_path, monkeypatch):
    state_file = tmp_path / "var" / "run" / "local-stack.env"
    state_file.parent.mkdir(parents=True)
    state_file.write_text(
        "\n".join(
            [
                "CONFIG_FILE=configs/config_preset_current_setup.yml",
                "BACKEND_PORT=8001",
                "FRONTEND_PORT=3005",
                "NEXT_PORT=3201",
            ]
        ),
        encoding="utf-8",
    )
    restart_script = tmp_path / "scripts" / "restart_local_stack.sh"
    restart_script.parent.mkdir(parents=True)
    restart_script.write_text("#!/bin/bash\n", encoding="utf-8")
    restart_script.chmod(0o755)

    monkeypatch.setattr(provider_routes, "_LOCAL_STACK_STATE_FILE", state_file)
    monkeypatch.setattr(provider_routes, "_LOCAL_STACK_RESTART_SCRIPT", restart_script)

    presets = [
        provider_routes.ConfigPresetResponseItem(
            id="preset_current_setup",
            name="current setup",
            config_path="configs/config_preset_current_setup.yml",
            description="Current setup",
            recommended=False,
            current=True,
        )
    ]

    runtime = _build_config_runtime(None, presets)

    assert runtime.can_apply_presets is True
    assert runtime.current_config_path == "configs/config_preset_current_setup.yml"
    assert runtime.backend_port == 8001
    assert runtime.frontend_port == 3005


def test_build_config_runtime_masks_generated_nat_runtime_name(tmp_path, monkeypatch):
    monkeypatch.setattr(provider_routes, "_LOCAL_STACK_STATE_FILE", tmp_path / "missing.env")
    monkeypatch.setattr(provider_routes, "_LOCAL_STACK_RESTART_SCRIPT", tmp_path / "missing.sh")

    runtime = _build_config_runtime("/tmp/nat_configdfpqk2r.yml", [])

    assert runtime.current_config_path == "/tmp/nat_configdfpqk2r.yml"
    assert runtime.current_config_name == "Generated runtime config"
