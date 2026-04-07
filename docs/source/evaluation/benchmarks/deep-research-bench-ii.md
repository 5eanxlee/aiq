<!--
SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->
# DeepResearch Bench II Evaluation of NVIDIA AI-Q Blueprint

[DeepResearch Bench II](https://github.com/imlrz/DeepResearch-Bench-II) evaluates deep research systems using fine-grained rubrics derived from expert-written reports. It measures three dimensions:

- Information Recall
- Analysis
- Presentation

On this branch, AI-Q produces the reports and the official DRB2 evaluator scores them.

## API Keys

The starter config in this directory mirrors the current max-quality preset. Edit it if your stack uses different providers.

```bash
export NVIDIA_API_KEY=your_key              # For NVIDIA-hosted models
export OPENAI_API_KEY=your_key              # For GPT-5.4 planner/orchestrator
export TAVILY_API_KEY=your_key              # For web search
export SERPER_API_KEY=your_key              # For paper search
```

## Configuration Files

| Config | Description |
|--------|-------------|
| `frontends/benchmarks/deepresearch_bench_II/configs/config_workflow_only.yml` | Starter DRB2 config for the current branch. Runs `deep_research_workflow` directly and saves per-task reports for the official evaluator. |

## Running Evaluation

### Step 1: Install the dataset

```bash
mkdir -p frontends/benchmarks/deepresearch_bench_II/data
wget https://raw.githubusercontent.com/imlrz/DeepResearch-Bench-II/refs/heads/main/tasks_and_rubrics.jsonl \
  -O frontends/benchmarks/deepresearch_bench_II/data/tasks_and_rubrics.jsonl
```

### Step 2: Generate reports with AI-Q

Run a single task first:

```bash
bash frontends/benchmarks/deepresearch_bench_II/scripts/run_workflow_save_per_item.sh --test
```

Run the full benchmark:

```bash
bash frontends/benchmarks/deepresearch_bench_II/scripts/run_workflow_save_per_item.sh \
  --output-dir frontends/benchmarks/deepresearch_bench_II/results/my-stack
```

The output directory contains:

- `workflow_output.json`
- `reports/idx-<task_idx>.md`
- `config.yml`
- `git_info.yml`

### Step 3: Prepare the official evaluator

```bash
git clone https://github.com/imlrz/DeepResearch-Bench-II.git /tmp/DeepResearch-Bench-II
mkdir -p /tmp/DeepResearch-Bench-II/report/my-stack
cp frontends/benchmarks/deepresearch_bench_II/results/my-stack/reports/idx-*.md \
  /tmp/DeepResearch-Bench-II/report/my-stack/
```

### Step 4: Run the official DRB2 scorer

```bash
cd /tmp/DeepResearch-Bench-II
cp .env_example .env
uv sync
uv run python run_evaluation.py
uv run python aggregate_scores.py --input result.jsonl --tasks-file tasks_and_rubrics.jsonl
```

## Custom Stack Notes

- Keep benchmark runs non-interactive. The provided config uses `deep_research_workflow` directly rather than the chat workflow and avoids plan approval.
- To benchmark a different stack, copy `config_workflow_only.yml` and swap the LLM or tool definitions in `llms` and `functions.deep_research_agent`.
- Keep the `config.yml` and `git_info.yml` files written by the helper script. They make it much easier to reproduce a strong score later.
