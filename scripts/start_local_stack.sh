#!/bin/bash
# SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
UI_DIR="$PROJECT_ROOT/frontends/ui"
VENV_DIR="$PROJECT_ROOT/.venv"
ENV_FILE="$PROJECT_ROOT/deploy/.env"
LOG_DIR="$PROJECT_ROOT/var/logs"
RUN_DIR="$PROJECT_ROOT/var/run"
STATE_FILE="$RUN_DIR/local-stack.env"
BACKEND_PID_FILE="$RUN_DIR/local-stack-backend.pid"
FRONTEND_PID_FILE="$RUN_DIR/local-stack-frontend.pid"

CONFIG_FILE="configs/config_web_default_llamaindex.yml"
BACKEND_PORT=8000
FRONTEND_PORT=3005
NEXT_PORT=3201
CLI_SET_CONFIG=false
CLI_SET_BACKEND_PORT=false
CLI_SET_FRONTEND_PORT=false
CLI_SET_NEXT_PORT=false

usage() {
    cat <<EOF
Usage: $0 [OPTIONS]

Start the local AI-Q development stack in the background and write logs to var/logs.

Options:
  --config_file PATH    Backend config file (default: configs/config_web_default_llamaindex.yml)
  --backend_port PORT   Backend port (default: 8000)
  --frontend_port PORT  Frontend gateway port (default: 3005)
  --next_port PORT      Internal Next.js port (default: 3201)
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
        --frontend_port)
            FRONTEND_PORT="$2"
            CLI_SET_FRONTEND_PORT=true
            shift 2
            ;;
        --next_port)
            NEXT_PORT="$2"
            CLI_SET_NEXT_PORT=true
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
REQUESTED_FRONTEND_PORT="$FRONTEND_PORT"
REQUESTED_NEXT_PORT="$NEXT_PORT"

if [ -f "$STATE_FILE" ]; then
    # shellcheck disable=SC1090
    source "$STATE_FILE"
fi

if [ "$CLI_SET_CONFIG" = true ]; then
    CONFIG_FILE="$REQUESTED_CONFIG_FILE"
fi
if [ "$CLI_SET_BACKEND_PORT" = true ]; then
    BACKEND_PORT="$REQUESTED_BACKEND_PORT"
fi
if [ "$CLI_SET_FRONTEND_PORT" = true ]; then
    FRONTEND_PORT="$REQUESTED_FRONTEND_PORT"
fi
if [ "$CLI_SET_NEXT_PORT" = true ]; then
    NEXT_PORT="$REQUESTED_NEXT_PORT"
fi

if [ ! -d "$VENV_DIR" ]; then
    echo "Virtual environment not found. Run ./scripts/setup.sh first."
    exit 1
fi

if [ ! -d "$UI_DIR/node_modules" ]; then
    echo "UI dependencies are missing. Run ./scripts/setup.sh or cd frontends/ui && npm ci"
    exit 1
fi

if [ ! -f "$PROJECT_ROOT/$CONFIG_FILE" ]; then
    echo "Config file not found: $CONFIG_FILE"
    exit 1
fi

if [ -f "$ENV_FILE" ]; then
    set -a
    source "$ENV_FILE"
    set +a
else
    echo "Warning: deploy/.env not found. Copy deploy/.env.example to deploy/.env if needed."
fi

mkdir -p "$PROJECT_ROOT/var" "$LOG_DIR" "$RUN_DIR"

BACKEND_LOG="$LOG_DIR/backend.log"
FRONTEND_LOG="$LOG_DIR/frontend.log"

port_in_use() {
    local port="$1"
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

describe_listener() {
    local port="$1"
    local pids
    pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    if [ -z "$pids" ]; then
        return
    fi
    for pid in $pids; do
        ps -p "$pid" -o pid=,command=
    done
}

wait_for_url() {
    local url="$1"
    local label="$2"
    local max_attempts="$3"
    local attempt=1

    while [ "$attempt" -le "$max_attempts" ]; do
        if curl -s -f "$url" >/dev/null 2>&1; then
            return 0
        fi
        sleep 1
        attempt=$((attempt + 1))
    done
    echo "$label did not become ready in time."
    return 1
}

pid_from_file() {
    local file="$1"
    if [ -f "$file" ]; then
        tr -d '[:space:]' < "$file"
    fi
}

pid_is_alive() {
    local pid="$1"
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
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

listener_pid_for_port() {
    local port="$1"
    local pids
    pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    if [ -z "$pids" ]; then
        return
    fi

    for pid in $pids; do
        if process_matches_stack "$pid"; then
            echo "$pid"
            return
        fi
    done
}

stop_pid_quietly() {
    local pid="$1"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null || true
    fi
}

cleanup_on_error() {
    stop_pid_quietly "${FRONTEND_PID:-}"
    stop_pid_quietly "${BACKEND_PID:-}"
    rm -f "$BACKEND_PID_FILE" "$FRONTEND_PID_FILE" "$STATE_FILE"
}

write_state_files() {
    local backend_pid="$1"
    local frontend_pid="$2"

    echo "$backend_pid" > "$BACKEND_PID_FILE"
    echo "$frontend_pid" > "$FRONTEND_PID_FILE"
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

report_already_running() {
    echo "Local AI-Q stack is already running."
    echo "Web UI:        http://localhost:${FRONTEND_PORT}"
    echo "Backend docs:  http://localhost:${BACKEND_PORT}/docs"
    echo ""
    echo "To restart:"
    echo "  ./scripts/restart_local_stack.sh"
}

refresh_state_from_live_stack() {
    local backend_listener_pid frontend_listener_pid next_listener_pid
    backend_listener_pid="$(listener_pid_for_port "$BACKEND_PORT")"
    frontend_listener_pid="$(listener_pid_for_port "$FRONTEND_PORT")"
    next_listener_pid="$(listener_pid_for_port "$NEXT_PORT")"

    if [ -z "$backend_listener_pid" ] || [ -z "$frontend_listener_pid" ] || [ -z "$next_listener_pid" ]; then
        return 1
    fi

    if ! curl -s -f "http://localhost:${BACKEND_PORT}/health" >/dev/null 2>&1; then
        return 1
    fi
    if ! curl -s -I "http://localhost:${FRONTEND_PORT}" >/dev/null 2>&1; then
        return 1
    fi

    write_state_files "$backend_listener_pid" "$frontend_listener_pid"
    return 0
}

existing_stack_processes() {
    local patterns=(
        "next dev --turbopack"
        "next-server"
        "node server.js"
        "concurrently"
        "start_server_in_debug_mode.sh"
        "nat serve"
    )

    ps -Ao pid=,command= | while read -r current_pid cmd; do
        [ -n "$current_pid" ] || continue
        for pattern in "${patterns[@]}"; do
            if [[ "$cmd" == *"$pattern"* ]]; then
                case "$cmd" in
                    *"$PROJECT_ROOT"*|*"start_server_in_debug_mode.sh"*)
                        echo "$current_pid $cmd"
                        break
                        ;;
                    *"next-server"*|*"node server.js"*|*"concurrently"*|*"nat serve"*|*"next dev --turbopack"*)
                        local parent_pid depth parent_cmd
                        parent_pid="$current_pid"
                        depth=0
                        while [ -n "$parent_pid" ] && [ "$parent_pid" != "1" ] && [ "$depth" -lt 8 ]; do
                            parent_cmd="$(ps -p "$parent_pid" -o command= 2>/dev/null || true)"
                            if [[ "$parent_cmd" == *"$PROJECT_ROOT"* ]] || [[ "$parent_cmd" == *"start_server_in_debug_mode.sh"* ]]; then
                                echo "$current_pid $cmd"
                                break 2
                            fi
                            parent_pid="$(ps -p "$parent_pid" -o ppid= 2>/dev/null | tr -d '[:space:]')"
                            depth=$((depth + 1))
                        done
                        ;;
                esac
            fi
        done
    done | sort -u
}

if refresh_state_from_live_stack; then
    report_already_running
    exit 0
fi

if [ -f "$BACKEND_PID_FILE" ] || [ -f "$FRONTEND_PID_FILE" ]; then
    BACKEND_PID_FROM_FILE="$(pid_from_file "$BACKEND_PID_FILE")"
    FRONTEND_PID_FROM_FILE="$(pid_from_file "$FRONTEND_PID_FILE")"

    if pid_is_alive "$BACKEND_PID_FROM_FILE" && pid_is_alive "$FRONTEND_PID_FROM_FILE"; then
        report_already_running
        exit 0
    fi

    if pid_is_alive "$BACKEND_PID_FROM_FILE" || pid_is_alive "$FRONTEND_PID_FROM_FILE"; then
        echo "Local stack state is inconsistent."
        echo "Run ./scripts/restart_local_stack.sh for a clean restart."
        exit 1
    fi

    rm -f "$BACKEND_PID_FILE" "$FRONTEND_PID_FILE" "$STATE_FILE"
fi

EXISTING_STACK_PROCESSES="$(existing_stack_processes || true)"
if [ -n "$EXISTING_STACK_PROCESSES" ]; then
    echo "Existing AI-Q local dev processes were found:"
    echo "$EXISTING_STACK_PROCESSES"
    echo ""
    echo "Run ./scripts/restart_local_stack.sh for a clean restart, or ./scripts/stop_local_stack.sh --hard to stop everything first."
    exit 1
fi

for port in "$BACKEND_PORT" "$FRONTEND_PORT" "$NEXT_PORT"; do
    if port_in_use "$port"; then
        echo "Port $port is already in use:"
        describe_listener "$port"
        echo "Free that port or run ./scripts/stop_local_stack.sh if it belongs to AI-Q."
        exit 1
    fi
done

: > "$BACKEND_LOG"
: > "$FRONTEND_LOG"

echo "Starting local AI-Q stack..."
echo "Backend:  http://localhost:${BACKEND_PORT}"
echo "Frontend: http://localhost:${FRONTEND_PORT}"
echo "Logs:"
echo "  $BACKEND_LOG"
echo "  $FRONTEND_LOG"
echo ""

nohup bash -lc "cd '$PROJECT_ROOT' && exec ./scripts/start_server_in_debug_mode.sh --config_file '$CONFIG_FILE' --port '$BACKEND_PORT'" \
    >>"$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!
echo "$BACKEND_PID" > "$BACKEND_PID_FILE"

if ! wait_for_url "http://localhost:${BACKEND_PORT}/health" "Backend" 120; then
    echo "Backend failed to start. Recent log output:"
    tail -n 40 "$BACKEND_LOG" || true
    cleanup_on_error
    exit 1
fi

nohup env \
    PORT="$FRONTEND_PORT" \
    BACKEND_URL="http://localhost:${BACKEND_PORT}" \
    NEXT_INTERNAL_URL="http://localhost:${NEXT_PORT}" \
    bash -lc "cd '$UI_DIR' && exec ./node_modules/.bin/concurrently --kill-others --names ',next' \"node server.js\" \"./node_modules/.bin/next dev --turbopack -p $NEXT_PORT\"" \
    >>"$FRONTEND_LOG" 2>&1 &
FRONTEND_PID=$!
echo "$FRONTEND_PID" > "$FRONTEND_PID_FILE"

if ! wait_for_url "http://localhost:${FRONTEND_PORT}" "Frontend" 120; then
    echo "Frontend failed to start. Recent log output:"
    tail -n 60 "$FRONTEND_LOG" || true
    cleanup_on_error
    exit 1
fi

write_state_files "$BACKEND_PID" "$FRONTEND_PID"

echo "Local AI-Q stack is ready."
echo "Web UI:        http://localhost:${FRONTEND_PORT}"
echo "Backend docs:  http://localhost:${BACKEND_PORT}/docs"
echo ""
echo "To stop:"
echo "  ./scripts/stop_local_stack.sh"
echo ""
echo "To restart after code changes:"
echo "  ./scripts/restart_local_stack.sh"
