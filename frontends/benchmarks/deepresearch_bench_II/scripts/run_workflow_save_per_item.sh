#!/bin/bash
# DeepResearch Bench II: run the deep research workflow and save one Markdown
# report per task so the outputs can be handed to the official evaluator.
#
# 1. Runs nat eval (workflow only, no evaluators) to produce workflow_output.json.
# 2. Splits workflow_output.json into output_dir/reports/idx-<idx>.md.
#
# Usage:
#   ./run_workflow_save_per_item.sh
#   ./run_workflow_save_per_item.sh my-run
#   ./run_workflow_save_per_item.sh --test
#   ./run_workflow_save_per_item.sh --output-dir my_run
#   ./run_workflow_save_per_item.sh --env deploy/.env

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BENCHMARK_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_ROOT="$(cd "$BENCHMARK_DIR/../../.." && pwd)"

TIMESTAMP=$(date '+%Y%m%d_%H%M%S')

CONFIG_FILE="frontends/benchmarks/deepresearch_bench_II/configs/config_workflow_only.yml"
ENV_FILE="deploy/.env"
PREFIX=""
TEST_FILTER_ID=1
PYTHON_BIN="${PYTHON_BIN:-python}"

while [[ $# -gt 0 ]]; do
    case $1 in
        --test)
            RUN_TEST=1
            shift
            ;;
        --output-dir)
            OUTPUT_DIR_REL="$2"
            shift 2
            ;;
        --env)
            ENV_FILE="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS] [PREFIX]"
            echo ""
            echo "Arguments:"
            echo "  PREFIX          Optional prefix for output directory name"
            echo ""
            echo "Options:"
            echo "  --test          Run a single item (idx=$TEST_FILTER_ID) for testing"
            echo "  --output-dir D  Output directory relative to project root"
            echo "  --env E         Env file path (default: $ENV_FILE)"
            echo "  --help, -h      Show this help"
            exit 0
            ;;
        *)
            if [ -z "${PREFIX}" ]; then
                PREFIX="$1"
                shift
            else
                echo "Unknown option: $1" >&2
                exit 1
            fi
            ;;
    esac
done

if [ -z "${OUTPUT_DIR_REL:-}" ]; then
    if [ -n "$PREFIX" ]; then
        OUTPUT_DIR_REL="${BENCHMARK_DIR#$PROJECT_ROOT/}/${PREFIX}"
    else
        OUTPUT_DIR_REL="${BENCHMARK_DIR#$PROJECT_ROOT/}/aggregated_results_${TIMESTAMP}"
    fi
fi

cd "$PROJECT_ROOT"

if [ -z "${VIRTUAL_ENV:-}" ]; then
    echo "Warning: VIRTUAL_ENV not set. Activate your venv before running." >&2
fi

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
    if command -v python3 >/dev/null 2>&1; then
        PYTHON_BIN=python3
    else
        echo "Error: neither python nor python3 was found on PATH." >&2
        exit 1
    fi
fi

ENV_PATH="${PROJECT_ROOT}/${ENV_FILE}"
if [ ! -f "$ENV_PATH" ]; then
    echo "Error: Env file not found: $ENV_PATH" >&2
    exit 1
fi

NAT_OVERRIDES=(
    --override "eval.general.output_dir" "$OUTPUT_DIR_REL"
)
if [ -n "${RUN_TEST:-}" ]; then
    NAT_OVERRIDES+=(--override "eval.general.dataset.filter.allowlist.field.idx" "[\"$TEST_FILTER_ID\"]")
fi

OUTPUT_DIR_ABS="${PROJECT_ROOT}/${OUTPUT_DIR_REL}"
mkdir -p "$OUTPUT_DIR_ABS"
cp "${PROJECT_ROOT}/${CONFIG_FILE}" "$OUTPUT_DIR_ABS/config.yml"
echo "Saved config snapshot: ${OUTPUT_DIR_REL}/config.yml"

GIT_BRANCH=$(git -C "$PROJECT_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
GIT_COMMIT=$(git -C "$PROJECT_ROOT" rev-parse HEAD 2>/dev/null || echo "unknown")
GIT_STATUS=$(git -C "$PROJECT_ROOT" status --short 2>/dev/null)
{
    echo "branch: $GIT_BRANCH"
    echo "commit: $GIT_COMMIT"
    echo "timestamp: $(date '+%Y-%m-%dT%H:%M:%S')"
    if [ -n "$GIT_STATUS" ]; then
        echo "dirty: true"
        echo "uncommitted_changes: |"
        echo "$GIT_STATUS" | sed 's/^/  /'
    else
        echo "dirty: false"
    fi
} > "$OUTPUT_DIR_ABS/git_info.yml"
echo "Saved git info: ${OUTPUT_DIR_REL}/git_info.yml (branch=$GIT_BRANCH, commit=${GIT_COMMIT:0:8})"

echo "Running workflow (output_dir=$OUTPUT_DIR_REL)..."
if ! dotenv -f "$ENV_PATH" run -- nat eval --config_file "$CONFIG_FILE" "${NAT_OVERRIDES[@]}"; then
    echo "nat eval failed." >&2
    exit 1
fi

WORKFLOW_JSON="${OUTPUT_DIR_ABS}/workflow_output.json"
if [ ! -f "$WORKFLOW_JSON" ]; then
    echo "Error: Expected $WORKFLOW_JSON after nat eval." >&2
    exit 1
fi

DATASET_JSONL="${BENCHMARK_DIR}/data/tasks_and_rubrics.jsonl"
echo "Splitting workflow_output.json into per-task Markdown reports..."
"$PYTHON_BIN" "${BENCHMARK_DIR}/scripts/split_workflow_output_to_per_item.py" \
    --input "$WORKFLOW_JSON" \
    --output-dir "$OUTPUT_DIR_ABS" \
    --dataset "$DATASET_JSONL"

echo "Done. Reports: ${OUTPUT_DIR_ABS}/reports/"
