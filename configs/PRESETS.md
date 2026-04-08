# Deep Research Presets

These presets are additive. They do not replace the shipped configs or the currently active local runtime config.

## Presets

- `config_preset_current_setup.yml`
  - Mirrors the current local setup in this workspace.
  - Uses Tavily + Semantic Scholar.
  - Uses GPT-OSS 120B via NVIDIA NIM for deep orchestration/planning.

- `config_preset_frontier_gpt54_xhigh.yml`
  - Recommended daily-driver frontier preset.
  - Uses GPT-5.4 with `reasoning_effort: xhigh` through the Responses API.
  - Keeps Nemotron Nano on the researcher side.

- `config_preset_frontier_gpt54_xhigh_super.yml`
  - Same frontier planner/orchestrator split, but upgrades the research workers to `nvidia/llama-3.3-nemotron-super-49b-v1.5`.

- `config_preset_nvidia_super_only.yml`
  - Best quality path without direct OpenAI routing.
  - Uses `nvidia/llama-3.3-nemotron-super-49b-v1.5` for clarifier, shallow research, and deep research.

- `config_preset_max_quality.yml`
  - Highest-quality preset on the current branch.
  - Uses GPT-5.4 with `xhigh` reasoning for clarification/planning/orchestration and `nvidia/llama-3.1-nemotron-ultra-253b-v1` for research work.
  - Assumes you accept higher latency and cost.

- `config_preset_max_quality_gpt54_medium.yml`
  - Same max-quality stack, but lowers GPT-5.4 to `reasoning_effort: medium`.
  - Keeps `nvidia/llama-3.1-nemotron-ultra-253b-v1` for research work.
  - Useful when you want the max-quality topology with a slightly cheaper/faster planner/orchestrator.

## Common Requirements

- NVIDIA-backed presets need `NVIDIA_API_KEY`.
- OpenAI-backed presets need `OPENAI_API_KEY`.
- Tavily-backed search needs `TAVILY_API_KEY`.
- Serper paper search needs `SERPER_API_KEY`.
- Semantic Scholar paper search can run without a key, but `SEMANTIC_SCHOLAR_API_KEY` is still supported.

## Usage

```bash
./scripts/start_server_in_debug_mode.sh --config_file configs/config_preset_max_quality.yml
```
