# Deep Research Presets

Standalone research workflow presets and runtime tweaks built on top of the NVIDIA AI-Q codebase.

This repository is focused on one thing: making the deep research stack easier to run, compare, and tune across different planner, orchestrator, and researcher model combinations.

## What This Repo Contains

- Curated deep research preset configs in [configs/](configs/)
- Prompt and workflow changes for the clarifier, planner, orchestrator, and researcher agents
- Async deep research UI and job-streaming improvements
- A detached standalone repository that keeps the underlying git history while tracking only this project's branch

## Project Focus

The main deliverable in this repo is the preset layer around deep research.

- GPT-5.4 frontier presets for planning and orchestration
- Higher-quality NVIDIA-only presets
- Max-quality presets that trade latency and cost for stronger reports
- A current local setup preset that mirrors the active branch defaults

The preset summary lives in [configs/PRESETS.md](configs/PRESETS.md).

## Key Files

- [configs/PRESETS.md](configs/PRESETS.md): human-readable overview of the preset lineup
- [configs/config_preset_frontier_gpt54_xhigh.yml](configs/config_preset_frontier_gpt54_xhigh.yml): recommended frontier preset
- [configs/config_preset_frontier_gpt54_xhigh_super.yml](configs/config_preset_frontier_gpt54_xhigh_super.yml): frontier planner with stronger research workers
- [configs/config_preset_max_quality.yml](configs/config_preset_max_quality.yml): highest-quality preset on this branch
- [configs/config_preset_max_quality_gpt54_medium.yml](configs/config_preset_max_quality_gpt54_medium.yml): lower-cost max-quality variant
- [configs/config_preset_nvidia_super_only.yml](configs/config_preset_nvidia_super_only.yml): strongest NVIDIA-only path
- [src/aiq_agent/agents/deep_researcher/prompts/planner.j2](src/aiq_agent/agents/deep_researcher/prompts/planner.j2): planner-agent system prompt
- [src/aiq_agent/agents/deep_researcher/prompts/orchestrator.j2](src/aiq_agent/agents/deep_researcher/prompts/orchestrator.j2): top-level deep research harness

## Quick Start

1. Install dependencies.

```bash
./scripts/setup.sh
```

2. Set the API keys you need.

- `NVIDIA_API_KEY` for NVIDIA-hosted models
- `OPENAI_API_KEY` for OpenAI-backed presets
- `TAVILY_API_KEY` for web search
- `SERPER_API_KEY` or `SEMANTIC_SCHOLAR_API_KEY` for paper search, depending on the preset

3. Start the stack with a preset.

```bash
./scripts/start_server_in_debug_mode.sh --config_file configs/config_preset_frontier_gpt54_xhigh.yml
```

4. Open the UI or debug console and run a deep research job.

## Common Presets

- `config_preset_frontier_gpt54_xhigh.yml`
  Recommended default if you want the strongest planner/orchestrator path.
- `config_preset_frontier_gpt54_xhigh_super.yml`
  Same planner/orchestrator path with better research workers.
- `config_preset_max_quality.yml`
  Best quality on this branch if cost and latency are acceptable.
- `config_preset_max_quality_gpt54_medium.yml`
  Same topology with a cheaper/faster GPT-5.4 planner.
- `config_preset_nvidia_super_only.yml`
  Best path if you want to stay fully on NVIDIA-hosted models.
- `config_preset_current_setup.yml`
  Mirrors the local branch's current working setup.

## Repository Layout

- `configs/`
  Preset YAMLs and runtime config variants.
- `src/`
  Core agent implementations, prompts, and shared workflow code.
- `frontends/`
  UI, CLI, debug console, and async API surfaces.
- `sources/`
  Search and knowledge-layer integrations.
- `docs/`
  Upstream-oriented documentation plus branch-specific references.

## Notes

- This repo is no longer a GitHub fork, but it preserves the underlying commit history.
- The branch and repo name are both `deep-research-presets`.
- If you want to understand planner behavior, start with:
  [src/aiq_agent/agents/deep_researcher/prompts/planner.j2](src/aiq_agent/agents/deep_researcher/prompts/planner.j2)
  and
  [src/aiq_agent/agents/deep_researcher/prompts/orchestrator.j2](src/aiq_agent/agents/deep_researcher/prompts/orchestrator.j2)

## License

This repository retains the upstream Apache 2.0 licensing in [LICENSE](LICENSE).
