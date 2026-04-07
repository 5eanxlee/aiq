#!/bin/bash
# SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
COMPOSE_DIR="$PROJECT_ROOT/deploy/compose"
ENV_FILE="$PROJECT_ROOT/deploy/.env"
VENV_DIR="$PROJECT_ROOT/.venv"
PHOENIX_VENV_DIR="$PROJECT_ROOT/.venv-phoenix"
CONFIG_FILE="configs/config_frontier_models_visibility.yml"
BUILD_ARGS=(--build)
START_PHOENIX=false

port_in_use() {
    local port="$1"
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

service_running() {
    local container_name="$1"
    docker ps --format '{{.Names}}' | grep -qx "$container_name"
}

running_service_host_port() {
    local container_name="$1"
    local container_port="$2"
    docker port "$container_name" "${container_port}/tcp" 2>/dev/null | sed -E 's#.*:([0-9]+)$#\1#' | head -n 1
}

next_free_port() {
    local port="$1"
    while port_in_use "$port"; do
        port=$((port + 1))
    done
    echo "$port"
}

ensure_host_port() {
    local env_name="$1"
    local default_port="$2"
    local container_name="$3"
    local container_port="$4"
    local desired_port="${!env_name:-$default_port}"
    local resolved_port="$desired_port"

    if service_running "$container_name"; then
        local active_port
        active_port="$(running_service_host_port "$container_name" "$container_port")"
        if [ -n "$active_port" ]; then
            resolved_port="$active_port"
        fi
    elif port_in_use "$desired_port"; then
        resolved_port="$(next_free_port "$((desired_port + 1))")"
        echo "Port $desired_port is already in use; using $resolved_port for $container_name."
    fi

    printf -v "$env_name" '%s' "$resolved_port"
    export "$env_name"
}

usage() {
    cat <<EOF
Usage: $0 [OPTIONS]

Start the full Docker Compose AI-Q stack with:
  - backend API
  - embedded Dask scheduler + worker
  - PostgreSQL
  - Next.js UI

Defaults to the high-capability frontier visibility config.

Options:
  --config_file PATH   Config file under configs/ (default: configs/config_frontier_models_visibility.yml)
  --no-build           Skip image build and use existing images
  --with-phoenix       Start local Phoenix on the host if not already running
  -h, --help           Show this help
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --config_file)
            CONFIG_FILE="$2"
            shift 2
            ;;
        --no-build)
            BUILD_ARGS=()
            shift
            ;;
        --with-phoenix)
            START_PHOENIX=true
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

if ! command -v docker >/dev/null 2>&1; then
    echo "Docker is not installed."
    exit 1
fi

if ! docker info >/dev/null 2>&1; then
    echo "Docker is installed but the daemon is not reachable. Start Docker Desktop and retry."
    exit 1
fi

if [ ! -d "$VENV_DIR" ]; then
    echo "Python virtual environment not found. Run ./scripts/setup.sh first."
    exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
    echo "deploy/.env not found. Copy deploy/.env.example to deploy/.env first."
    exit 1
fi

if [ ! -f "$PROJECT_ROOT/$CONFIG_FILE" ]; then
    echo "Config file not found: $CONFIG_FILE"
    exit 1
fi

CONFIG_BASENAME="$(basename "$CONFIG_FILE")"
CONTAINER_CONFIG="/app/configs/$CONFIG_BASENAME"

if [ ! -f "$PROJECT_ROOT/configs/$CONFIG_BASENAME" ]; then
    echo "Config must live under configs/ so Docker can mount it. Could not find: configs/$CONFIG_BASENAME"
    exit 1
fi

set -a
source "$ENV_FILE"
set +a

ensure_host_port PORT 8000 aiq-agent 8000
ensure_host_port DASK_DASHBOARD_PORT 8787 aiq-agent 8787
ensure_host_port FRONTEND_PORT 3000 aiq-blueprint-ui 3000
ensure_host_port POSTGRES_PORT 5432 aiq-postgres 5432

if [ -z "${NVIDIA_API_KEY:-}" ] || [ -z "${TAVILY_API_KEY:-}" ]; then
    echo "Required keys missing in deploy/.env. NVIDIA_API_KEY and TAVILY_API_KEY are required."
    exit 1
fi

# Validate provider keys against the selected config using the local venv.
if ! NAT_CONFIG_FILE="$PROJECT_ROOT/$CONFIG_FILE" "$VENV_DIR/bin/python" - <<'PY'; then
from pathlib import Path
import os
import sys
import yaml

from aiq_agent.common.config_validation import validate_llm_configs

config_path = Path(os.environ["NAT_CONFIG_FILE"])
config = yaml.safe_load(config_path.read_text())
ok, missing = validate_llm_configs(config)
if not ok:
    print("Missing required API keys for selected config:", ", ".join(missing))
    sys.exit(1)
PY
    exit 1
fi

# Container-safe Phoenix endpoint: if deploy/.env is configured for localhost,
# the container would try to send traces to itself rather than the host.
if [ -z "${PHOENIX_COLLECTOR_ENDPOINT:-}" ] || [[ "${PHOENIX_COLLECTOR_ENDPOINT}" == *"127.0.0.1"* ]] || [[ "${PHOENIX_COLLECTOR_ENDPOINT}" == *"localhost"* ]]; then
    export PHOENIX_COLLECTOR_ENDPOINT="http://host.docker.internal:6006/v1/traces"
fi

if [ -z "${PHOENIX_PROJECT:-}" ]; then
    export PHOENIX_PROJECT="aiq-docker"
fi

if [ "$START_PHOENIX" = true ]; then
    if [ ! -x "$PHOENIX_VENV_DIR/bin/phoenix" ]; then
        echo "Phoenix runtime not found at .venv-phoenix. Start without --with-phoenix or install Phoenix there."
        exit 1
    fi

    if ! curl -s -f http://127.0.0.1:6006 >/dev/null 2>&1; then
        echo "Starting local Phoenix on the host..."
        "$PHOENIX_VENV_DIR/bin/phoenix" serve >/tmp/aiq-phoenix.log 2>&1 &
        sleep 3
    fi
fi

export BACKEND_CONFIG="$CONTAINER_CONFIG"

echo "================================================"
echo "Starting AI-Q Full Docker Stack"
echo "================================================"
echo ""
echo "Config:              $CONFIG_FILE"
echo "Container config:    $BACKEND_CONFIG"
echo "Phoenix collector:   ${PHOENIX_COLLECTOR_ENDPOINT}"
echo "Backend port:        ${PORT}"
echo "Frontend port:       ${FRONTEND_PORT}"
echo "Dask port:           ${DASK_DASHBOARD_PORT}"
echo "Postgres port:       ${POSTGRES_PORT}"
echo "Compose directory:   $COMPOSE_DIR"
echo ""

(
    cd "$COMPOSE_DIR"
    COMPOSE_CMD=(docker compose --env-file ../.env -f docker-compose.yaml up -d)
    if [ ${#BUILD_ARGS[@]} -gt 0 ]; then
        COMPOSE_CMD+=("${BUILD_ARGS[@]}")
    fi
    "${COMPOSE_CMD[@]}"
)

echo ""
echo "--------------------------------------------"
echo "Full Stack URLs"
echo "--------------------------------------------"
echo "Backend API docs:  http://localhost:${PORT:-8000}/docs"
echo "Debug console:     http://localhost:${PORT:-8000}/debug"
echo "Web UI:            http://localhost:${FRONTEND_PORT:-3000}"
echo "Dask dashboard:    http://localhost:${DASK_DASHBOARD_PORT:-8787}"
if [ "$START_PHOENIX" = true ] || curl -s -f http://127.0.0.1:6006 >/dev/null 2>&1; then
    echo "Phoenix traces:     http://localhost:6006"
fi
echo ""
echo "To stop:"
echo "  cd $COMPOSE_DIR && docker compose --env-file ../.env -f docker-compose.yaml down"
echo ""
