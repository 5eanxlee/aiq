# SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

from aiq_agent.common.citation_verification import SourceEntry
from aiq_agent.common.citation_verification import SourceRegistry
from aiq_agent.common.citation_verification import reset_session_registry
from aiq_agent.common.citation_verification import set_session_registry
from aiq_api.jobs.callbacks import AgentEventCallback


class _FakeEventStore:
    def __init__(self) -> None:
        self.job_id = "job-123"
        self.events: list[dict] = []

    def store(self, event: dict) -> None:
        self.events.append(event)


def test_emit_final_report_emits_citation_use_events_for_verified_sources():
    event_store = _FakeEventStore()
    callback = AgentEventCallback(event_store=event_store)

    registry = SourceRegistry()
    registry.add(SourceEntry(url="https://example.com/report", title="Example Report"))
    token = set_session_registry(registry)

    try:
        callback.emit_final_report(
            "# Report\n\n## Sources\n[1] Example Report: https://example.com/report\n"
        )
    finally:
        reset_session_registry(token)
        AgentEventCallback.cleanup_job_urls(event_store.job_id)

    artifact_events = [event for event in event_store.events if event.get("type") == "artifact.update"]

    assert any(
        event.get("data", {}).get("type") == "output"
        and event.get("data", {}).get("output_category") == "final_report"
        for event in artifact_events
    )
    assert any(
        event.get("data", {}).get("type") == "citation_use"
        and event.get("data", {}).get("url") == "https://example.com/report"
        for event in artifact_events
    )
