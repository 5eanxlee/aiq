#!/bin/bash
# SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
RUN_DIR="$PROJECT_ROOT/var/run"
STATE_FILE="$RUN_DIR/local-stack.env"
BACKEND_PID_FILE="$RUN_DIR/local-stack-backend.pid"
FRONTEND_PID_FILE="$RUN_DIR/local-stack-frontend.pid"
COMPOSE_DIR="$PROJECT_ROOT/deploy/compose"
ENV_FILE="$PROJECT_ROOT/deploy/.env"

BACKEND_PORT=8000
FRONTEND_PORT=3005
NEXT_PORT=3201
QUIET=false
HARD=false

usage() {
    cat <<EOF
Usage: $0 [OPTIONS]

Stop the background local AI-Q stack started by ./scripts/start_local_stack.sh.

Options:
  --hard       Also kill stale AI-Q dev processes and stop the AI-Q Docker Compose stack
  --quiet      Suppress non-error output
  -h, --help   Show this help
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --quiet)
            QUIET=true
            shift
            ;;
        --hard)
            HARD=true
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

if [ -f "$STATE_FILE" ]; then
    # shellcheck disable=SC1090
    source "$STATE_FILE"
fi

pid_from_file() {
    local file="$1"
    if [ -f "$file" ]; then
        tr -d '[:space:]' < "$file"
    fi
}

process_parent_pid() {
    local pid="$1"
    ps -p "$pid" -o ppid= 2>/dev/null | tr -d '[:space:]'
}

process_command() {
    local pid="$1"
    ps -p "$pid" -o command= 2>/dev/null
}

process_matches_stack() {
    local current_pid="$1"
    local depth=0

    while [ -n "$current_pid" ] && [ "$current_pid" != "1" ] && [ "$depth" -lt 8 ]; do
        local cmd
        cmd="$(process_command "$current_pid")"
        if [[ "$cmd" == *"$PROJECT_ROOT"* ]] || \
           [[ "$cmd" == *"start_server_in_debug_mode.sh"* ]] || \
           [[ "$cmd" == *"node server.js"* ]] || \
           [[ "$cmd" == *"next dev --turbopack"* ]] || \
           [[ "$cmd" == *"concurrently"* ]]; then
            return 0
        fi
        current_pid="$(process_parent_pid "$current_pid")"
        depth=$((depth + 1))
    done

    return 1
}

stop_pid() {
    local pid="$1"
    local label="$2"

    if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
        return
    fi

    if [ "$QUIET" = false ]; then
        echo "Stopping $label ($pid)..."
    fi
    kill "$pid" 2>/dev/null || true

    local attempt=1
    while [ "$attempt" -le 20 ]; do
        if ! kill -0 "$pid" 2>/dev/null; then
            return
        fi
        sleep 1
        attempt=$((attempt + 1))
    done

    if [ "$QUIET" = false ]; then
        echo "$label did not exit in time; forcing shutdown."
    fi
    kill -9 "$pid" 2>/dev/null || true
}

stop_listener_if_matches() {
    local port="$1"
    local label="$2"
    local pids

    pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    if [ -z "$pids" ]; then
        return
    fi

    for pid in $pids; do
        if process_matches_stack "$pid"; then
            stop_pid "$pid" "$label listener"
        fi
    done
}

kill_stale_stack_processes() {
    local patterns=(
        "next dev --turbopack"
        "next-server"
        "node server.js"
        "concurrently"
        "start_server_in_debug_mode.sh"
        "nat serve"
    )
    local pid

    while read -r pid; do
        [ -n "$pid" ] || continue
        stop_pid "$pid" "stale aiq process"
    done < <(
        ps -Ao pid=,command= | while read -r current_pid cmd; do
            [ -n "$current_pid" ] || continue
            for pattern in "${patterns[@]}"; do
                if [[ "$cmd" == *"$pattern"* ]] && process_matches_stack "$current_pid"; then
                    echo "$current_pid"
                    break
                fi
            done
        done | sort -u
    )
}

stop_compose_stack() {
    if ! command -v docker >/dev/null 2>&1; then
        return
    fi
    if [ ! -f "$COMPOSE_DIR/docker-compose.yaml" ]; then
        return
    fi

    if [ "$QUIET" = false ]; then
        echo "Stopping AI-Q Docker Compose stack..."
    fi

    (
        cd "$COMPOSE_DIR"
        if [ -f "$ENV_FILE" ]; then
            docker compose --env-file ../.env -f docker-compose.yaml down >/dev/null 2>&1 || true
        else
            docker compose -f docker-compose.yaml down >/dev/null 2>&1 || true
        fi
    ) &
    local compose_pid=$!
    local attempt=1

    while [ "$attempt" -le 15 ]; do
        if ! kill -0 "$compose_pid" 2>/dev/null; then
            wait "$compose_pid" 2>/dev/null || true
            return
        fi
        sleep 1
        attempt=$((attempt + 1))
    done

    if [ "$QUIET" = false ]; then
        echo "Docker Compose shutdown timed out; continuing with local cleanup."
    fi
    kill "$compose_pid" 2>/dev/null || true
    sleep 1
    kill -9 "$compose_pid" 2>/dev/null || true
    wait "$compose_pid" 2>/dev/null || true
}

BACKEND_PID="$(pid_from_file "$BACKEND_PID_FILE")"
FRONTEND_PID="$(pid_from_file "$FRONTEND_PID_FILE")"

stop_pid "$FRONTEND_PID" "frontend"
stop_pid "$BACKEND_PID" "backend"

stop_listener_if_matches "$FRONTEND_PORT" "frontend"
stop_listener_if_matches "$NEXT_PORT" "Next.js"
stop_listener_if_matches "$BACKEND_PORT" "backend"

if [ "$HARD" = true ]; then
    kill_stale_stack_processes
    stop_compose_stack
fi

rm -f "$BACKEND_PID_FILE" "$FRONTEND_PID_FILE" "$STATE_FILE"

if [ "$QUIET" = false ]; then
    echo "Local AI-Q stack stopped."
fi
