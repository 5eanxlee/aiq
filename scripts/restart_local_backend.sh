#!/bin/bash
# SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
RUN_DIR="$PROJECT_ROOT/var/run"
LOG_DIR="$PROJECT_ROOT/var/logs"
STATE_FILE="$RUN_DIR/local-stack.env"
BACKEND_PID_FILE="$RUN_DIR/local-stack-backend.pid"
FRONTEND_PID_FILE="$RUN_DIR/local-stack-frontend.pid"
RELOAD_STATUS_FILE="$RUN_DIR/backend-reload-status.json"
ENV_FILE="$PROJECT_ROOT/deploy/.env"
VENV_DIR="$PROJECT_ROOT/.venv"

CONFIG_FILE="configs/config_web_default_llamaindex.yml"
BACKEND_PORT=8000
OPERATION_ID="reload-$(date +%s)"
CLI_SET_CONFIG=false
CLI_SET_BACKEND_PORT=false

usage() {
    cat <<EOF
Usage: $0 [OPTIONS]

Reload the local AI-Q backend process without restarting the frontend.

Options:
  --config_file PATH    Backend config file (default: current local stack config)
  --backend_port PORT   Backend port (default: current local stack port)
  --operation_id ID     Stable identifier for reload status tracking
  -h, --help            Show this help
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --config_file)
            CONFIG_FILE="$2"
            CLI_SET_CONFIG=true
            shift 2
            ;;
        --backend_port)
            BACKEND_PORT="$2"
            CLI_SET_BACKEND_PORT=true
            shift 2
            ;;
        --operation_id)
            OPERATION_ID="$2"
            shift 2
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

REQUESTED_CONFIG_FILE="$CONFIG_FILE"
REQUESTED_BACKEND_PORT="$BACKEND_PORT"

if [ -f "$STATE_FILE" ]; then
    # shellcheck disable=SC1090
    source "$STATE_FILE"
fi

CURRENT_CONFIG_FILE="${CONFIG_FILE:-configs/config_web_default_llamaindex.yml}"

if [ -f "$ENV_FILE" ]; then
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
fi

if [ "$CLI_SET_CONFIG" = true ]; then
    CONFIG_FILE="$REQUESTED_CONFIG_FILE"
fi
if [ "$CLI_SET_BACKEND_PORT" = true ]; then
    BACKEND_PORT="$REQUESTED_BACKEND_PORT"
fi

FRONTEND_PORT="${FRONTEND_PORT:-3005}"
NEXT_PORT="${NEXT_PORT:-3201}"
BACKEND_LOG="${BACKEND_LOG:-$LOG_DIR/backend.log}"
FRONTEND_LOG="${FRONTEND_LOG:-$LOG_DIR/frontend.log}"

mkdir -p "$RUN_DIR" "$LOG_DIR"

write_reload_status() {
    local state="$1"
    local message="$2"
    local error_text="${3:-}"
    local config_path="${4:-$CONFIG_FILE}"
    local previous_config_path="${5:-${CURRENT_CONFIG_FILE:-}}"
    local rollback_attempted="${6:-false}"
    local rollback_succeeded="${7:-false}"

    node - "$RELOAD_STATUS_FILE" "$state" "$message" "$error_text" "$config_path" "$previous_config_path" \
        "$rollback_attempted" "$rollback_succeeded" "$BACKEND_PORT" "$FRONTEND_PORT" "$BACKEND_LOG" "$OPERATION_ID" <<'NODE'
const fs = require('fs')
const [
  file,
  state,
  message,
  errorText,
  configPath,
  previousConfigPath,
  rollbackAttempted,
  rollbackSucceeded,
  backendPort,
  frontendPort,
  logPath,
  operationId,
] = process.argv.slice(2)

const payload = {
  operation_id: operationId || null,
  state,
  message,
  error: errorText || null,
  config_path: configPath || null,
  previous_config_path: previousConfigPath || null,
  backend_url: backendPort ? `http://localhost:${backendPort}` : null,
  frontend_url: frontendPort ? `http://localhost:${frontendPort}` : null,
  log_path: logPath || null,
  rollback_attempted: rollbackAttempted === 'true',
  rollback_succeeded: rollbackSucceeded === 'true',
  updated_at: new Date().toISOString(),
}

fs.writeFileSync(file, JSON.stringify(payload, null, 2))
NODE
}

if [ ! -f "$PROJECT_ROOT/$CONFIG_FILE" ]; then
    write_reload_status "failed" "The requested config file does not exist." "Config file not found: $CONFIG_FILE" "$CONFIG_FILE" "$CURRENT_CONFIG_FILE"
    echo "Config file not found: $CONFIG_FILE"
    exit 1
fi

validate_config() {
    "$VENV_DIR/bin/python" - "$PROJECT_ROOT/$CONFIG_FILE" <<'PY'
import sys
from nat.runtime.loader import load_config

load_config(sys.argv[1])
PY
}

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
           [[ "$cmd" == *"nat serve"* ]]; then
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

    echo "Stopping $label ($pid)..."
    kill "$pid" 2>/dev/null || true

    local attempt=1
    while [ "$attempt" -le 20 ]; do
        if ! kill -0 "$pid" 2>/dev/null; then
            return
        fi
        sleep 1
        attempt=$((attempt + 1))
    done

    echo "$label did not exit in time; forcing shutdown."
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

kill_stale_backend_processes() {
    local patterns=(
        "start_server_in_debug_mode.sh"
        "nat serve"
    )
    local pid

    while read -r pid; do
        [ -n "$pid" ] || continue
        stop_pid "$pid" "stale backend process"
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

wait_for_url() {
    local url="$1"
    local label="$2"
    local max_attempts="$3"
    local watch_pid="${4:-}"
    local attempt=1

    while [ "$attempt" -le "$max_attempts" ]; do
        if curl -s -f "$url" >/dev/null 2>&1; then
            return 0
        fi
        if [ -n "$watch_pid" ] && ! kill -0 "$watch_pid" 2>/dev/null; then
            echo "$label exited before becoming ready."
            return 1
        fi
        sleep 1
        attempt=$((attempt + 1))
    done
    echo "$label did not become ready in time."
    return 1
}

wait_for_port_release() {
    local port="$1"
    local label="$2"
    local attempt=1

    while [ "$attempt" -le 40 ]; do
        if ! lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
            return 0
        fi
        sleep 0.5
        attempt=$((attempt + 1))
    done

    echo "$label port $port did not become free in time."
    return 1
}

write_state_file() {
    local backend_pid="$1"
    local frontend_pid="$2"

    echo "$backend_pid" > "$BACKEND_PID_FILE"
    cat > "$STATE_FILE" <<EOF
CONFIG_FILE=$CONFIG_FILE
BACKEND_PORT=$BACKEND_PORT
FRONTEND_PORT=$FRONTEND_PORT
NEXT_PORT=$NEXT_PORT
BACKEND_LOG=$BACKEND_LOG
FRONTEND_LOG=$FRONTEND_LOG
BACKEND_PID=$backend_pid
FRONTEND_PID=$frontend_pid
EOF
}

BACKEND_PID="$(pid_from_file "$BACKEND_PID_FILE")"
FRONTEND_PID_VALUE="${FRONTEND_PID:-$(pid_from_file "$FRONTEND_PID_FILE")}"

echo ""
echo "Reloading local AI-Q backend..."
echo "Config:   $CONFIG_FILE"
echo "Backend:  http://localhost:${BACKEND_PORT}"
echo "Frontend: http://localhost:${FRONTEND_PORT}"
echo ""

write_reload_status "validating" "Validating the requested backend config before stopping the running server."

VALIDATION_OUTPUT=""
if ! VALIDATION_OUTPUT="$(validate_config 2>&1)"; then
    write_reload_status \
        "failed" \
        "The requested config could not be validated. The running backend was left untouched." \
        "$VALIDATION_OUTPUT" \
        "$CONFIG_FILE" \
        "$CURRENT_CONFIG_FILE" \
        "false" \
        "false"
    echo "Config validation failed. The current backend is still running."
    echo "$VALIDATION_OUTPUT"
    exit 1
fi

write_reload_status "stopping" "Stopping the current backend before starting the new config." "" "$CONFIG_FILE" "$CURRENT_CONFIG_FILE"
stop_pid "$BACKEND_PID" "backend"
stop_listener_if_matches "$BACKEND_PORT" "backend"
kill_stale_backend_processes
if ! wait_for_port_release "$BACKEND_PORT" "Backend"; then
    write_reload_status \
        "failed" \
        "The previous backend process would not release its port, so the reload was aborted." \
        "Backend port $BACKEND_PORT remained busy after shutdown attempts." \
        "$CONFIG_FILE" \
        "$CURRENT_CONFIG_FILE" \
        "false" \
        "false"
    exit 1
fi

printf '\n===== %s restarting backend with %s =====\n' "$(date)" "$CONFIG_FILE" >>"$BACKEND_LOG"
write_reload_status "starting" "Starting the backend with the selected research config." "" "$CONFIG_FILE" "$CURRENT_CONFIG_FILE"
nohup bash -lc "cd '$PROJECT_ROOT' && exec ./scripts/start_server_in_debug_mode.sh --config_file '$CONFIG_FILE' --port '$BACKEND_PORT'" \
    >>"$BACKEND_LOG" 2>&1 &
NEW_BACKEND_PID=$!

if ! wait_for_url "http://localhost:${BACKEND_PORT}/health" "Backend" 120 "$NEW_BACKEND_PID"; then
    START_ERROR="Backend failed to become healthy after the reload."
    write_reload_status \
        "rolling_back" \
        "The requested config failed to start. Attempting to restore the previous backend config." \
        "$START_ERROR" \
        "$CONFIG_FILE" \
        "$CURRENT_CONFIG_FILE" \
        "true" \
        "false"

    if [ -n "$CURRENT_CONFIG_FILE" ] && [ -f "$PROJECT_ROOT/$CURRENT_CONFIG_FILE" ]; then
        stop_pid "$NEW_BACKEND_PID" "failed backend"
        stop_listener_if_matches "$BACKEND_PORT" "backend"
        kill_stale_backend_processes
        wait_for_port_release "$BACKEND_PORT" "Backend" || true

        printf '\n===== %s rolling back backend to %s =====\n' "$(date)" "$CURRENT_CONFIG_FILE" >>"$BACKEND_LOG"
        nohup bash -lc "cd '$PROJECT_ROOT' && exec ./scripts/start_server_in_debug_mode.sh --config_file '$CURRENT_CONFIG_FILE' --port '$BACKEND_PORT'" \
            >>"$BACKEND_LOG" 2>&1 &
        ROLLBACK_BACKEND_PID=$!

        if wait_for_url "http://localhost:${BACKEND_PORT}/health" "Rollback backend" 120 "$ROLLBACK_BACKEND_PID"; then
            CONFIG_FILE="$CURRENT_CONFIG_FILE"
            write_state_file "$ROLLBACK_BACKEND_PID" "$FRONTEND_PID_VALUE"
            write_reload_status \
                "rolled_back" \
                "The requested config failed, and the previous backend config was restored." \
                "$START_ERROR" \
                "$REQUESTED_CONFIG_FILE" \
                "$CURRENT_CONFIG_FILE" \
                "true" \
                "true"
            echo "Backend reload failed. Previous config restored."
            tail -n 40 "$BACKEND_LOG" || true
            exit 1
        fi
    fi

    write_reload_status \
        "failed" \
        "The requested config failed to start, and the previous config could not be restored automatically." \
        "$START_ERROR" \
        "$REQUESTED_CONFIG_FILE" \
        "$CURRENT_CONFIG_FILE" \
        "true" \
        "false"
    echo "Backend failed to restart. Recent log output:"
    tail -n 40 "$BACKEND_LOG" || true
    exit 1
fi

write_state_file "$NEW_BACKEND_PID" "$FRONTEND_PID_VALUE"
write_reload_status "ready" "The backend is healthy and running the selected research config." "" "$CONFIG_FILE" "$CURRENT_CONFIG_FILE"

echo "Local AI-Q backend is ready."
echo "Web UI:        http://localhost:${FRONTEND_PORT}"
echo "Backend docs:  http://localhost:${BACKEND_PORT}/docs"
