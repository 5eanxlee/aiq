# Development Scripts

This directory contains helper scripts for developing and running the AI-Q blueprint.

## Available Scripts

### `setup.sh` - Initial Setup

Initializes the development environment, including Python dependencies and UI dependencies.

```bash
./scripts/setup.sh
```

### `dev.sh` - Development Helper

Main development command hub for common tasks.

```bash
./scripts/dev.sh <command>
```

**Commands:**

| Command | Description |
|---------|-------------|
| `test` | Run tests with pytest |
| `format` | Format code with ruff (imports) and yapf |
| `lint` | Check code formatting (no changes) |
| `pre-commit` | Format code and run lint checks |
| `pylint` | Run pylint static analysis |
| `run` | Run the agent |
| `clean` | Remove build artifacts |
| `help` | Show help message |

### `start_cli.sh` - CLI Mode

Starts the agent in CLI mode with browser-based authentication.

```bash
./scripts/start_cli.sh
./scripts/start_cli.sh --verbose
```

**Options:**

| Option | Description |
|--------|-------------|
| `--verbose` or `-v` | Enable verbose logging |
| `--config_file <path>` | Use a custom configuration file |


### `start_server_in_debug_mode.sh` - Server Mode

Starts the NAT FastAPI server for deep research with async job support.

```bash
./scripts/start_server_in_debug_mode.sh
./scripts/start_server_in_debug_mode.sh --port 8080
./scripts/start_server_in_debug_mode.sh --config_file configs/config_web_frag.yml
```

**Options:**

| Option | Description |
|--------|-------------|
| `--port <port>` | Server port (default: 8000) |
| `--config_file <path>` | Use a custom configuration file |

**Available Endpoints:**

| Endpoint | Description |
|----------|-------------|
| `http://localhost:8000/docs` | API Documentation (Swagger UI) |
| `http://localhost:8000/debug` | Debug Console for testing async jobs |
| `http://localhost:8000/health` | Health check |
| `http://localhost:8000/v1/jobs/async/agents` | List available agent types |
| `http://localhost:8000/v1/jobs/async/submit` | Submit async job (POST) |
| `http://localhost:8000/v1/jobs/async/job/{id}/stream` | SSE stream for job progress |

### `start_local_stack.sh` / `stop_local_stack.sh` / `restart_local_stack.sh` / `restart_local_backend.sh` - Fast Local Loop

Starts or stops the local backend + frontend dev stack in the background with pid files and logs.
This is the quickest way to run, kill, and redeploy during UI/backend iteration.

```bash
./scripts/start_local_stack.sh
./scripts/stop_local_stack.sh
./scripts/restart_local_stack.sh
./scripts/restart_local_backend.sh
```

**Recommended loop:**

```bash
./scripts/start_local_stack.sh
./scripts/restart_local_stack.sh    # after backend/proxy/config updates
./scripts/restart_local_backend.sh  # after model/config changes when frontend can stay up
./scripts/stop_local_stack.sh --hard
```

**Defaults:**

| Setting | Value |
|---------|-------|
| Backend | `http://localhost:8000` |
| Frontend | `http://localhost:3005` |
| Internal Next.js | `http://localhost:3201` |
| Logs | `var/logs/backend.log`, `var/logs/frontend.log` |

**Options (`start_local_stack.sh`):**

| Option | Description |
|--------|-------------|
| `--config_file <path>` | Backend config file |
| `--backend_port <port>` | Backend port (default: 8000) |
| `--frontend_port <port>` | Frontend port (default: 3005) |
| `--next_port <port>` | Internal Next.js port (default: 3201) |

`stop_local_stack.sh --hard` is the reliable cleanup command. It stops the background stack, kills stale AI-Q dev processes from this repo, and brings down the AI-Q Docker Compose stack if it is running.

`restart_local_backend.sh` reloads only the backend process on the current port. It is what the frontend config switcher uses when the app was started via `./scripts/start_local_stack.sh`.

### `start_max_quality_stack.sh` - One-Command Max Config

Restarts the local stack into the max-quality preset:

```bash
./scripts/start_max_quality_stack.sh
```

It is equivalent to:

```bash
./scripts/restart_local_stack.sh --config_file configs/config_preset_max_quality.yml
```

You can still pass normal local-stack overrides such as:

```bash
./scripts/start_max_quality_stack.sh --backend_port 8001 --frontend_port 3005 --next_port 3201
```

### `start_visibility_stack.sh` - High-Visibility Mode

Starts the local inspection stack in one command:

- Phoenix trace UI
- AI-Q backend with `/debug`
- Next.js web UI

```bash
./scripts/start_visibility_stack.sh
./scripts/start_visibility_stack.sh --no-ui
./scripts/start_visibility_stack.sh --config_file configs/config_web_visibility_llamaindex.yml
```

**Services:**

| Service | URL |
|---------|-----|
| Phoenix | `http://localhost:6006` |
| Backend | `http://localhost:8000` |
| Debug Console | `http://localhost:8000/debug` |
| Frontend | `http://localhost:3000` |

### `start_docker_full_stack.sh` - Full Docker Stack

Starts the production-shaped local stack through Docker Compose using the
high-capability config by default:

- backend API
- embedded Dask scheduler + worker
- PostgreSQL
- Next.js web UI
- optional host Phoenix tracing

```bash
./scripts/start_docker_full_stack.sh
./scripts/start_docker_full_stack.sh --with-phoenix
./scripts/start_docker_full_stack.sh --config_file configs/config_web_visibility_llamaindex.yml
```

**Services:**

| Service | URL |
|---------|-----|
| Backend | `http://localhost:8000` |
| Debug Console | `http://localhost:8000/debug` |
| Frontend | `http://localhost:3000` |
| Dask Dashboard | `http://localhost:8787` |
| Phoenix (optional) | `http://localhost:6006` |

### `start_e2e.sh` - End-to-End Mode

Starts both backend and frontend for full WebSocket support and HITL workflows.

```bash
./scripts/start_e2e.sh
```

**Services:**

| Service | URL |
|---------|-----|
| Backend | `http://localhost:8000` |
| Frontend | `http://localhost:3000` |

**Available Configs:**

| Config File | Description |
|-------------|-------------|
| `configs/config_cli_default.yml` | CLI mode with web search (default) |
| `configs/config_web_frag.yml` | Server/E2E mode with Foundational RAG (default) |
| `configs/config_web_default_llamaindex.yml` | Server/E2E mode with LlamaIndex |

## Development Workflow

When developing new features:

1. **Update code**: Make your changes to the codebase
2. **Test your changes**:
   ```bash
   ./scripts/dev.sh test
   ```
3. **Format and lint**:
   ```bash
   ./scripts/dev.sh pre-commit
   ```
4. **Run the agent**:
   ```bash
   ./scripts/start_cli.sh
   # OR
   ./scripts/start_e2e.sh
   ```
