#!/bin/bash
# SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
VENV_DIR="$PROJECT_ROOT/.venv"
PHOENIX_VENV_DIR="$PROJECT_ROOT/.venv-phoenix"
UI_DIR="$PROJECT_ROOT/frontends/ui"
CONFIG_FILE="configs/config_web_visibility_llamaindex.yml"
BACKEND_PORT=8000
PHOENIX_PORT=6006
START_UI=true

while [[ $# -gt 0 ]]; do
    case $1 in
        --config_file)
            CONFIG_FILE="$2"
            shift 2
            ;;
        --backend_port)
            BACKEND_PORT="$2"
            shift 2
            ;;
        --no-ui)
            START_UI=false
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Starts the high-visibility local stack:"
            echo "  - Phoenix tracing UI"
            echo "  - AI-Q backend with /debug"
            echo "  - Next.js UI"
            echo ""
            echo "Options:"
            echo "  --config_file PATH   Config file (default: configs/config_web_visibility_llamaindex.yml)"
            echo "  --backend_port PORT  Backend port (default: 8000)"
            echo "  --no-ui              Skip the Next.js UI and only run Phoenix + backend"
            echo "  -h, --help           Show this help"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage"
            exit 1
            ;;
    esac
done

if [ ! -d "$VENV_DIR" ]; then
    echo "Virtual environment not found. Run ./scripts/setup.sh first."
    exit 1
fi

if [ ! -f "$PROJECT_ROOT/$CONFIG_FILE" ]; then
    echo "Config file not found: $CONFIG_FILE"
    exit 1
fi

if [ -f "$PROJECT_ROOT/deploy/.env" ]; then
    set -a
    source "$PROJECT_ROOT/deploy/.env"
    set +a
else
    echo "Warning: No deploy/.env file found. Copy deploy/.env.example to deploy/.env"
fi

export PYTHONWARNINGS="${PYTHONWARNINGS:-ignore}"
export AIQ_DEV_ENV=visibility
export BACKEND_URL="http://localhost:${BACKEND_PORT}"
export NEXT_PUBLIC_BACKEND_URL="http://localhost:${BACKEND_PORT}"
mkdir -p "$PROJECT_ROOT/var"

cleanup() {
    echo ""
    echo "Shutting down visibility stack..."
    if [ -n "${FRONTEND_PID:-}" ]; then
        kill "$FRONTEND_PID" 2>/dev/null || true
    fi
    if [ -n "${BACKEND_PID:-}" ]; then
        kill "$BACKEND_PID" 2>/dev/null || true
    fi
    if [ -n "${PHOENIX_PID:-}" ]; then
        kill "$PHOENIX_PID" 2>/dev/null || true
    fi
    exit 0
}

trap cleanup SIGINT SIGTERM

wait_for_url() {
    local url="$1"
    local label="$2"
    local max_attempts="$3"
    local attempt=1

    echo "Waiting for ${label}..."
    while [ "$attempt" -le "$max_attempts" ]; do
        if curl -s -f "$url" > /dev/null 2>&1; then
            echo "${label} is ready"
            return 0
        fi
        printf "."
        sleep 1
        attempt=$((attempt + 1))
    done
    echo ""
    echo "${label} did not become ready in time"
    return 1
}

echo "================================================"
echo "Starting AI-Q Visibility Stack"
echo "================================================"
echo ""
echo "Config:   $(basename "$CONFIG_FILE")"
echo "Backend:  http://localhost:${BACKEND_PORT}"
echo "Phoenix:  http://localhost:${PHOENIX_PORT}"
[ "$START_UI" = true ] && echo "Frontend: http://localhost:3000"
echo ""

if [ ! -x "$PHOENIX_VENV_DIR/bin/phoenix" ]; then
    echo "Phoenix runtime not found at .venv-phoenix."
    echo "Run: uv venv .venv-phoenix && source .venv-phoenix/bin/activate && uv pip install arize-phoenix"
    exit 1
fi

echo "Starting Phoenix..."
"$PHOENIX_VENV_DIR/bin/phoenix" serve &
PHOENIX_PID=$!
wait_for_url "http://127.0.0.1:${PHOENIX_PORT}" "Phoenix UI" 30 || true

echo ""
echo "Starting AI-Q backend with debug console..."
"$VENV_DIR/bin/nat" serve --config_file "$CONFIG_FILE" --host 0.0.0.0 --port "$BACKEND_PORT" &
BACKEND_PID=$!
wait_for_url "http://localhost:${BACKEND_PORT}/docs" "AI-Q backend" 90 || true

if [ "$START_UI" = true ]; then
    if [ ! -d "$UI_DIR/node_modules" ]; then
        echo ""
        echo "UI dependencies missing in frontends/ui/node_modules."
        echo "Run ./scripts/setup.sh or cd frontends/ui && npm ci"
        cleanup
    fi

    echo ""
    echo "Starting Next.js UI..."
    (
        cd "$UI_DIR"
        npm run dev
    ) &
    FRONTEND_PID=$!
fi

echo ""
echo "--------------------------------------------"
echo "Visibility URLs"
echo "--------------------------------------------"
echo "Phoenix traces:    http://localhost:${PHOENIX_PORT}"
echo "Backend API docs:  http://localhost:${BACKEND_PORT}/docs"
echo "Debug console:     http://localhost:${BACKEND_PORT}/debug"
[ "$START_UI" = true ] && echo "Web UI:            http://localhost:3000"
echo ""
echo "LangSmith tracing is also enabled if LANGCHAIN_TRACING_V2/LANGCHAIN_API_KEY are set in deploy/.env."
echo ""
echo "Press Ctrl+C to stop all processes."
echo ""

wait
