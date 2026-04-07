#!/bin/bash
# SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
STATE_FILE="$PROJECT_ROOT/var/run/local-stack.env"

ARGS=("$@")

if [ "$#" -eq 0 ] && [ -f "$STATE_FILE" ]; then
    # shellcheck disable=SC1090
    source "$STATE_FILE"
    ARGS=()
    [ -n "${CONFIG_FILE:-}" ] && ARGS+=(--config_file "$CONFIG_FILE")
    [ -n "${BACKEND_PORT:-}" ] && ARGS+=(--backend_port "$BACKEND_PORT")
    [ -n "${FRONTEND_PORT:-}" ] && ARGS+=(--frontend_port "$FRONTEND_PORT")
    [ -n "${NEXT_PORT:-}" ] && ARGS+=(--next_port "$NEXT_PORT")
fi

"$SCRIPT_DIR/stop_local_stack.sh" --hard --quiet || true
"$SCRIPT_DIR/start_local_stack.sh" "${ARGS[@]}"
