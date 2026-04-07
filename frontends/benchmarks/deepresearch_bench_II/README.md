# DeepResearch Bench II Evaluation of NVIDIA AI-Q Blueprint

[DeepResearch Bench II](https://github.com/imlrz/DeepResearch-Bench-II) evaluates deep research systems with fine-grained rubrics derived from expert-written reports. The benchmark scores outputs across information recall, analysis, and presentation.

This directory provides a workflow-only harness for the current branch:

- Run AI-Q over the official `tasks_and_rubrics.jsonl` dataset
- Save one Markdown report per task
- Hand those reports to the official DRB2 evaluator to obtain comparable scores

## API Keys

The starter config in this directory mirrors the current max-quality stack. Edit it if your stack uses different providers.

```bash
export NVIDIA_API_KEY=your_key              # For NVIDIA-hosted models
export OPENAI_API_KEY=your_key              # For GPT-5.4 planner/orchestrator
export TAVILY_API_KEY=your_key              # For web search
export SERPER_API_KEY=your_key              # For paper search
```

## Configuration Files

| Configuration file | Description |
| --- | --- |
| `frontends/benchmarks/deepresearch_bench_II/configs/config_workflow_only.yml` | Starter DRB2 config for the current branch. Runs the deep research workflow only and writes report text for the official evaluator. |

## Running Evaluation

### Step 1: Download the DRB2 task file

```bash
mkdir -p frontends/benchmarks/deepresearch_bench_II/data
wget https://raw.githubusercontent.com/imlrz/DeepResearch-Bench-II/refs/heads/main/tasks_and_rubrics.jsonl \
  -O frontends/benchmarks/deepresearch_bench_II/data/tasks_and_rubrics.jsonl
```

### Step 2: Generate one report per task with AI-Q

Run a single task first to validate the stack:

```bash
bash frontends/benchmarks/deepresearch_bench_II/scripts/run_workflow_save_per_item.sh --test
```

Run the full benchmark:

```bash
bash frontends/benchmarks/deepresearch_bench_II/scripts/run_workflow_save_per_item.sh \
  --output-dir frontends/benchmarks/deepresearch_bench_II/results/my-stack
```

The script writes:

- `workflow_output.json`
- `reports/idx-<task_idx>.md`
- `config.yml`
- `git_info.yml`

### Step 3: Copy the generated reports into the official evaluator

```bash
git clone https://github.com/imlrz/DeepResearch-Bench-II.git /tmp/DeepResearch-Bench-II
mkdir -p /tmp/DeepResearch-Bench-II/report/my-stack
cp frontends/benchmarks/deepresearch_bench_II/results/my-stack/reports/idx-*.md \
  /tmp/DeepResearch-Bench-II/report/my-stack/
```

### Step 4: Run the official DRB2 evaluator

```bash
cd /tmp/DeepResearch-Bench-II
cp .env_example .env
uv sync
uv run python run_evaluation.py
uv run python aggregate_scores.py --input result.jsonl --tasks-file tasks_and_rubrics.jsonl
```

The official evaluator writes aggregated CSVs such as:

- `agg_scores_inforecall.csv`
- `agg_scores_analysis.csv`
- `agg_scores_presentation.csv`
- `agg_scores_total.csv`

## Custom Stack Notes

- Keep the benchmark run non-interactive. The provided config uses `deep_research_workflow` directly instead of the chat workflow.
- If your stack uses different models, endpoints, or tools, copy `config_workflow_only.yml` and change the `llms` and `functions.deep_research_agent` sections.
- The official evaluator accepts Markdown output, so you do not need to render PDFs unless you want to benchmark a richer output format.
