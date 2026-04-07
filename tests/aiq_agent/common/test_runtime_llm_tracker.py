# SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

from types import SimpleNamespace

from aiq_agent.common.runtime_llm_tracker import RuntimeLLMTrackerCallback
from aiq_agent.common.runtime_llm_tracker import get_runtime_model_activity


def test_runtime_llm_tracker_records_runtime_observation(tmp_path, monkeypatch):
    tracker_db = tmp_path / "runtime-llm.sqlite3"
    monkeypatch.setenv("AIQ_RUNTIME_LLM_TRACKER_DB", str(tracker_db))

    callback = RuntimeLLMTrackerCallback("deep_research_agent")
    callback.on_chat_model_start(
        {
            "name": "ChatNVIDIA",
            "kwargs": {
                "model": "openai/gpt-oss-120b",
                "base_url": "https://integrate.api.nvidia.com/v1",
                "temperature": 1.0,
                "top_p": 1.0,
                "max_tokens": 256000,
            },
        },
        messages=[["hello"]],
        run_id="run-1",
    )

    response = SimpleNamespace(
        generations=[
            [
                SimpleNamespace(
                    message=SimpleNamespace(
                        response_metadata={
                            "model_name": "openai/gpt-oss-120b",
                            "token_usage": {
                                "prompt_tokens": 120,
                                "completion_tokens": 80,
                                "total_tokens": 200,
                            },
                        }
                    )
                )
            ]
        ]
    )
    callback.on_llm_end(response, run_id="run-1")

    observations = get_runtime_model_activity(window_seconds=3600)

    assert len(observations) == 1
    observation = observations[0]
    assert observation.worker == "deep_research_agent"
    assert observation.provider_id == "nvidia"
    assert observation.model_name == "openai/gpt-oss-120b"
    assert observation.endpoint == "https://integrate.api.nvidia.com/v1"
    assert observation.temperature == 1.0
    assert observation.top_p == 1.0
    assert observation.max_tokens == 256000
    assert observation.call_count == 1
    assert observation.prompt_tokens == 120
    assert observation.completion_tokens == 80
    assert observation.total_tokens == 200
