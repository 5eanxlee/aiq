# AI-Q Runtime Flow and Runbook

This document traces the AI-Q runtime chronologically from process launch to final report output, with emphasis on:

- Which scripts are actually run
- Which config, prompt, and markdown-like files are read
- Which local state and outputs are created
- How document ingestion and async deep research fit into the flow
- Which knobs matter before you start changing the architecture

It is written against this checkout of the repository and should be treated as the local source of truth.

## 1. What Actually Runs

There are two different meanings of "what runs":

1. Shell and process launchers that start the system.
2. Agent-runtime steps inside NAT, LangGraph, and `deepagents` after the Python server or CLI is already running.

The important distinction is:

- The shell scripts in [`scripts/`](../scripts) only launch and wire services.
- The research workflow itself is not a shell-script pipeline. Once the process is up, the work happens inside Python agents, LangGraph state machines, and `deepagents` virtual tools.

That means a "deep research run" does not execute repo shell scripts after startup. Instead it invokes agent nodes and internal tools such as `task`, `write_todos`, `read_file`, `write_file`, `edit_file`, `ls`, `grep`, and configured search tools.

## 2. Main Runtime Entry Points

These are the primary launchers you will actually use:

- [`scripts/setup.sh`](../scripts/setup.sh): bootstrap local dev environment, install Python and UI dependencies, seed `deploy/.env`.
- [`scripts/start_cli.sh`](../scripts/start_cli.sh): interactive terminal workflow.
- [`scripts/start_server_in_debug_mode.sh`](../scripts/start_server_in_debug_mode.sh): backend only, with `/docs`, `/debug`, and API routes.
- [`scripts/start_e2e.sh`](../scripts/start_e2e.sh): backend plus Next.js UI for end-to-end local use.
- [`scripts/start_visibility_stack.sh`](../scripts/start_visibility_stack.sh): local high-visibility stack with Phoenix, backend, and optional UI.

The project is registered into NeMo Agent Toolkit via Python package entry points in [`pyproject.toml`](../pyproject.toml):

- `aiq_chat_researcher`
- `aiq_shallow_researcher`
- `aiq_deep_researcher`
- `aiq_fastapi_extensions`
- `aiq_clarifier`

Those registrations are the bridge between the YAML config and the actual Python code.

## 3. Chronological Runtime Flow

### Phase 0: Setup Before First Run

If you run:

```bash
./scripts/setup.sh
```

the script does the following:

1. Installs `uv` if needed.
2. Creates `.venv` pinned to Python 3.13.
3. Runs `uv sync --dev --extra docs` for the root package.
4. Installs editable frontends:
   - `frontends/cli`
   - `frontends/debug`
   - `frontends/aiq_api`
5. Installs benchmark packages.
6. Installs source plugins:
   - `sources/tavily_web_search`
   - `sources/google_scholar_paper_search`
   - `sources/knowledge_layer[llamaindex,foundational_rag]`
7. Installs `pre-commit` hooks.
8. Copies `deploy/.env.example` to `deploy/.env` if missing.
9. Installs UI dependencies in `frontends/ui` if `npm` exists.

Local outputs created here:

- `.venv/`
- `deploy/.env`
- `var/`
- `frontends/ui/node_modules/` if UI deps are installed

### Phase 1: Launcher Script Reads Env and Starts Processes

#### A. Best-visibility stack

If you run:

```bash
./scripts/start_visibility_stack.sh --config_file configs/config_frontier_models_visibility.yml
```

the launcher:

1. Reads `deploy/.env`.
2. Sets:
   - `AIQ_DEV_ENV=visibility`
   - `BACKEND_URL=http://localhost:8000`
   - `NEXT_PUBLIC_BACKEND_URL=http://localhost:8000`
3. Starts local Phoenix from `.venv-phoenix/bin/phoenix serve`.
4. Starts the NAT backend with:

```bash
.venv/bin/nat serve --config_file configs/config_frontier_models_visibility.yml --host 0.0.0.0 --port 8000
```

5. Starts the Next.js UI with `npm run dev` unless `--no-ui` is used.

This is the most useful local learning and debugging entry point because it gives you:

- Phoenix traces
- FastAPI docs
- `/debug`
- the UI

Important nuance:

- This launcher does not create a Dask scheduler for you.
- If `NAT_DASK_SCHEDULER_ADDRESS` is not already set, configs with `use_async_deep_research: true` fall back to synchronous deep-research execution.
- That still gives you backend traces and visibility, but not the full async deep-research job pipeline.

#### B. Backend-only debug mode

If you run:

```bash
./scripts/start_server_in_debug_mode.sh --config_file configs/config_web_default_llamaindex.yml
```

the script:

1. Loads `deploy/.env`.
2. Confirms the config contains a `front_end:` section.
3. Activates `.venv`.
4. Runs `nat serve`.

This is the simplest way to get:

- `http://localhost:8000/docs`
- `http://localhost:8000/debug`
- `http://localhost:8000/health`

#### C. End-to-end local web mode

If you run:

```bash
./scripts/start_e2e.sh --config_file configs/config_web_default_llamaindex.yml
```

the script:

1. Loads `deploy/.env`.
2. Exports `BACKEND_URL` and `NEXT_PUBLIC_BACKEND_URL`.
3. Ensures NAT is importable.
4. Ensures `frontends/ui/node_modules` exists or runs `npm ci`.
5. Starts `nat serve`.
6. Waits for backend health.
7. Starts the Next.js UI.

Like the visibility launcher, this does not automatically create a Dask cluster by itself.

#### D. Interactive CLI

If you run:

```bash
./scripts/start_cli.sh --config_file configs/config_cli_default.yml --verbose
```

the script:

1. Loads `deploy/.env`.
2. Sets `AIQ_DEV_ENV=cli`.
3. Sets `AIQ_VERBOSE=true` when `--verbose` is passed.
4. Launches the CLI entry point:

```bash
.venv/bin/aiq-research --config_file configs/config_cli_default.yml
```

The CLI is always the inline workflow path. It does not use the async deep-research job system.

### Phase 2: NAT Loads YAML Config and Registers Components

Once `nat serve` or `aiq-research` starts, NAT reads the selected YAML config. The config is the runtime assembly file for the whole system.

The most relevant configs in this repo are:

- [`configs/config_web_visibility_llamaindex.yml`](../configs/config_web_visibility_llamaindex.yml)
- [`configs/config_frontier_models_visibility.yml`](../configs/config_frontier_models_visibility.yml)
- [`configs/config_web_default_llamaindex.yml`](../configs/config_web_default_llamaindex.yml)
- [`configs/config_frontier_models.yml`](../configs/config_frontier_models.yml)
- [`configs/config_web_frag.yml`](../configs/config_web_frag.yml)
- [`configs/config_cli_default.yml`](../configs/config_cli_default.yml)

At startup, NAT resolves four top-level sections:

- `general`
- `llms`
- `functions`
- `workflow`

Important files read during this phase:

- `deploy/.env`
- selected YAML config file
- Python package entry points from [`pyproject.toml`](../pyproject.toml)

### Phase 3: Early API-key Validation

Before the main workflow is allowed to run, the orchestrator registration code in [`src/aiq_agent/agents/chat_researcher/register.py`](../src/aiq_agent/agents/chat_researcher/register.py) tries to find the config path from:

- `NAT_CONFIG_FILE`, or
- `--config_file` in `sys.argv`

It then reads the YAML and validates required provider keys using [`src/aiq_agent/common/config_validation.py`](../src/aiq_agent/common/config_validation.py).

Provider-to-env mapping currently includes:

- `nim -> NVIDIA_API_KEY`
- `openai -> OPENAI_API_KEY`
- `anthropic -> ANTHROPIC_API_KEY`
- `google/gemini -> GOOGLE_API_KEY`

If a required key is missing, the workflow returns a graceful error instead of failing deep inside the run.

### Phase 4: Plugin and Tool Construction

The selected config causes NAT to instantiate:

- LLMs from the `llms:` block
- Tools from the `functions:` block
- The top-level workflow from the `workflow:` block

Core runtime plugin registrations come from:

- [`src/aiq_agent/agents/chat_researcher/register.py`](../src/aiq_agent/agents/chat_researcher/register.py)
- [`src/aiq_agent/agents/shallow_researcher/register.py`](../src/aiq_agent/agents/shallow_researcher/register.py)
- [`src/aiq_agent/agents/deep_researcher/register.py`](../src/aiq_agent/agents/deep_researcher/register.py)
- [`src/aiq_agent/agents/clarifier/register.py`](../src/aiq_agent/agents/clarifier/register.py)
- [`sources/knowledge_layer/src/register.py`](../sources/knowledge_layer/src/register.py)
- [`sources/tavily_web_search/src/register.py`](../sources/tavily_web_search/src/register.py)
- [`sources/google_scholar_paper_search/src/register.py`](../sources/google_scholar_paper_search/src/register.py)

At this stage:

- the role-based `LLMProvider` is configured
- tools are created
- verbose callbacks may be attached
- the knowledge backend is initialized
- the active document ingestor is made available to FastAPI routes

### Phase 5: A User Query Enters the Orchestrator

The top-level workflow is the `chat_deepresearcher_agent` defined in [`src/aiq_agent/agents/chat_researcher/register.py`](../src/aiq_agent/agents/chat_researcher/register.py) and implemented in [`src/aiq_agent/agents/chat_researcher/agent.py`](../src/aiq_agent/agents/chat_researcher/agent.py).

When a user submits a query:

1. A conversation ID is established.
2. Authenticated user info is loaded if present.
3. The user payload is parsed into:
   - query text
   - optional `data_sources`
4. Available uploaded-document summaries are loaded from the summary DB.
5. A session-scoped citation registry is created.
6. A `ChatResearcherState` is constructed.
7. The LangGraph workflow starts.

Important runtime inputs read here:

- `Context.get().conversation_id`
- user message payload
- summary DB for uploaded document summaries
- selected data-source filters

Local state created here:

- session-scoped citation registry
- LangGraph state/checkpoint entries

### Phase 6: Intent Classification

The first actual agent step is the intent classifier.

Code:

- [`src/aiq_agent/agents/chat_researcher/nodes/intent_classifier.py`](../src/aiq_agent/agents/chat_researcher/nodes/intent_classifier.py)

Prompt file read:

- [`src/aiq_agent/agents/chat_researcher/prompts/intent_classification.j2`](../src/aiq_agent/agents/chat_researcher/prompts/intent_classification.j2)

This prompt gets rendered with:

- `query`
- `current_datetime`
- `user_info`
- tool metadata

It returns JSON with:

- `intent`: `meta` or `research`
- `meta_response`
- `research_depth`: `shallow` or `deep`
- `depth_reasoning`

This step decides:

- casual/system question -> respond immediately
- simple research -> shallow path
- complex/comparative/comprehensive research -> clarifier then deep path

### Phase 7: Optional Data-source Filtering

If the caller provided `data_sources`, tools are filtered by [`src/aiq_agent/common/data_sources.py`](../src/aiq_agent/common/data_sources.py).

Current routing is simple:

- `web_search` keeps Tavily/web tools
- `knowledge_layer` keeps knowledge/document tools
- everything else stays available

This matters operationally because a run can intentionally exclude either:

- the internet, or
- your uploaded document corpus

### Phase 8A: Shallow Research Path

If the query is routed to shallow research, the workflow invokes [`src/aiq_agent/agents/shallow_researcher/agent.py`](../src/aiq_agent/agents/shallow_researcher/agent.py).

Prompt file read:

- [`src/aiq_agent/agents/shallow_researcher/prompts/researcher.j2`](../src/aiq_agent/agents/shallow_researcher/prompts/researcher.j2)

The shallow prompt is rendered with:

- current datetime
- user info
- tool list
- available uploaded-document summaries

What that prompt instructs:

- prioritize user docs first when relevant
- use `knowledge_search` for uploaded files
- rewrite vague web queries into search-friendly ones
- use inline `[1]` citations and a references section
- stay within a bounded tool budget

Actual runtime behavior:

1. The agent message list is wrapped with a rendered system prompt.
2. The LLM is bound to tools with `parallel_tool_calls=True`.
3. The LangGraph loop alternates between:
   - `agent`
   - `tools`
4. Tool calls are counted against `max_tool_iterations`.
5. If the budget is exhausted, the system injects a synthesis-only anchor.
6. Tool results are parsed for URLs and citation keys and added to the active source registry.
7. Final output is post-processed through:
   - citation verification
   - report sanitization

Important local outputs:

- in-memory or session citation registry entries
- possibly SSE events for tool calls and outputs
- final verified answer

Important failure mode:

- if no verifiable sources are captured, the agent raises `EmptySourceRegistryError`

### Phase 8B: Escalation From Shallow to Deep

The orchestrator can escalate from shallow to deep if:

- the shallow result explicitly says to escalate, or
- the final answer contains heuristic insufficiency language

This logic lives in [`src/aiq_agent/agents/chat_researcher/agent.py`](../src/aiq_agent/agents/chat_researcher/agent.py).

### Phase 9: Clarifier Path Before Deep Research

Before expensive deep research, the clarifier may run.

Code:

- [`src/aiq_agent/agents/clarifier/agent.py`](../src/aiq_agent/agents/clarifier/agent.py)

Prompt files read:

- [`src/aiq_agent/agents/clarifier/prompts/research_clarification.j2`](../src/aiq_agent/agents/clarifier/prompts/research_clarification.j2)
- [`src/aiq_agent/agents/clarifier/prompts/plan_generation.j2`](../src/aiq_agent/agents/clarifier/prompts/plan_generation.j2)

What the clarifier prompt does:

- decides whether the research request is actually ambiguous enough to need clarification
- avoids unnecessary friction for already-clear questions
- treats uploaded docs as the obvious referent for "my paper", "my file", etc.
- uses at most 1-2 search calls for clarifier context only
- returns strict JSON only

What the plan-generation prompt does:

- creates a lightweight title and 5-8 sections
- optionally loops with user approval/feedback

Chronology:

1. Clarifier renders prompt with:
   - prior clarifier log
   - available document summaries
   - tool descriptions
2. It may call tools for context.
3. After tool results, it appends a JSON-only reminder.
4. It asks the user a clarification question if needed.
5. It records a clarification log.
6. If enabled, it generates a plan preview and asks the user to approve, reject, or revise.
7. Approved plan context is appended to `clarifier_result`.
8. The deep researcher receives that context.

Local outputs:

- clarification log
- plan title and section list
- approved/rejected state

### Phase 10: Deep Research Path

The deep researcher is implemented in [`src/aiq_agent/agents/deep_researcher/agent.py`](../src/aiq_agent/agents/deep_researcher/agent.py).

Prompt files read:

- [`src/aiq_agent/agents/deep_researcher/prompts/planner.j2`](../src/aiq_agent/agents/deep_researcher/prompts/planner.j2)
- [`src/aiq_agent/agents/deep_researcher/prompts/researcher.j2`](../src/aiq_agent/agents/deep_researcher/prompts/researcher.j2)
- [`src/aiq_agent/agents/deep_researcher/prompts/orchestrator.j2`](../src/aiq_agent/agents/deep_researcher/prompts/orchestrator.j2)
- [`src/aiq_agent/agents/deep_researcher/prompts/source_registry.j2`](../src/aiq_agent/agents/deep_researcher/prompts/source_registry.j2)

#### Deep runtime architecture

The deep path uses `deepagents.create_deep_agent` with:

- one orchestrator
- one `planner-agent`
- one `researcher-agent`
- middleware
- a virtual file backend
- an in-memory shared store

#### What the planner prompt does

The planner prompt instructs the planner to:

- discover what exists first using tools
- distinguish internal vs external topics
- build a structured TOC
- derive constraints from evidence
- output self-contained research queries
- write the plan to `/shared/plan.json`

#### What the researcher prompt does

The researcher prompt instructs the researcher to:

- use `knowledge_search` first for user documents
- use `paper_search_tool` for scholarly topics
- use `advanced_web_search_tool` for current/practical/web topics
- stay within an 8-call budget
- write detailed notes with citations to `/shared/[query_topic_x].txt`

#### What the orchestrator prompt does

The orchestrator prompt instructs the orchestrator to:

1. write todos
2. call the planner via `task()`
3. read `/shared/plan.json`
4. delegate research queries to `researcher-agent`
5. verify after each researcher task using `think`
6. synthesize by inspecting `/shared/*`
7. call `get_verified_sources`
8. write the final report to `/report.md`
9. return the report

#### Important runtime clarification

The tools mentioned above are not repo shell scripts. They are virtual tools available inside `deepagents`.

The three most important virtual files are:

- `/shared/plan.json`
- `/shared/[query_topic_x].txt`
- `/report.md`

These are runtime artifacts inside the deep-agent environment. They are not normal files in the repo working tree.

#### Middleware that shapes deep-agent behavior

The deep path also injects custom middleware from [`src/aiq_agent/agents/deep_researcher/custom_middleware.py`](../src/aiq_agent/agents/deep_researcher/custom_middleware.py):

- `EmptyContentFixMiddleware`
- `ToolNameSanitizationMiddleware`
- `ToolRetryMiddleware`
- `SourceRegistryMiddleware`
- `ToolResultPruningMiddleware`
- `ModelRetryMiddleware`

What these do in practice:

- repair empty tool outputs
- fix hallucinated or malformed tool names
- retry failed tools
- capture tool-returned sources for citation verification
- prune older tool results to reduce context bloat
- retry LLM calls

#### Deep report completeness loop

After a deep run, the system checks whether the report is complete. It rejects reports that are:

- too short
- missing section headers
- missing sources/references section
- missing valid citations
- giving up or asking the user to confirm next steps

If incomplete, it injects corrective feedback and asks the deep agent to fix the existing draft instead of restarting.

#### Final post-processing

Once the deep report is extracted:

1. citations are verified against the captured source registry
2. invalid citations are removed
3. URLs are sanitized
4. the cleaned report is re-emitted to the frontend as the authoritative final report

### Phase 11: Knowledge Layer and Uploaded Documents

If your config includes `knowledge_search`, the knowledge plugin in [`sources/knowledge_layer/src/register.py`](../sources/knowledge_layer/src/register.py) initializes both:

- a retriever
- an ingestor

That plugin also:

- configures the summary DB
- chooses the backend
- activates the ingestor for FastAPI routes

#### Backends

The repo supports:

- `llamaindex`: local in-process retrieval over ChromaDB
- `foundational_rag`: remote NVIDIA RAG Blueprint HTTP services

For the local backend, the key implementation is:

- [`sources/knowledge_layer/src/llamaindex/adapter.py`](../sources/knowledge_layer/src/llamaindex/adapter.py)

#### What happens when you upload a document

Upload flow entry points:

- [`src/aiq_agent/fastapi_extensions/routes/collections.py`](../src/aiq_agent/fastapi_extensions/routes/collections.py)
- [`src/aiq_agent/fastapi_extensions/routes/documents.py`](../src/aiq_agent/fastapi_extensions/routes/documents.py)

Chronology:

1. You create a collection.
2. You upload files to `/v1/collections/{collection}/documents`.
3. FastAPI writes uploaded bytes to temporary files.
4. The ingestor receives a background ingestion job.
5. For the local LlamaIndex backend:
   - files are read from temp paths
   - text is chunked
   - embeddings are created
   - chunks are stored in ChromaDB
   - optional tables/images/charts are extracted
   - optional one-sentence document summaries are generated
   - summaries are stored in the summary DB
6. Temporary files are removed after ingestion if cleanup is enabled.

What gets ingested:

- PDFs
- TXT
- MD
- DOCX
- optionally PPTX depending on backend/setup

What the agent later sees:

- retrieved chunks during `knowledge_search`
- document summaries loaded into prompt context before research starts

#### Important local outputs from ingestion

- ChromaDB persistence directory, default `/tmp/chroma_data`
- summary DB, default `./var/summaries.db`
- in-memory ingestion job/file tracking inside the local ingestor

### Phase 12: Async Deep Research Jobs

If `use_async_deep_research: true` is enabled and Dask/job-store infrastructure is available, the deep path does not run inline. Instead it submits an async job.

Main files:

- [`frontends/aiq_api/src/aiq_api/registry.py`](../frontends/aiq_api/src/aiq_api/registry.py)
- [`frontends/aiq_api/src/aiq_api/routes/jobs.py`](../frontends/aiq_api/src/aiq_api/routes/jobs.py)
- [`frontends/aiq_api/src/aiq_api/jobs/runner.py`](../frontends/aiq_api/src/aiq_api/jobs/runner.py)
- [`frontends/aiq_api/src/aiq_api/jobs/callbacks.py`](../frontends/aiq_api/src/aiq_api/jobs/callbacks.py)

Chronology:

1. The orchestrator submits `agent_type=deep_researcher`.
2. The request is stored in the job store.
3. A Dask worker receives the task.
4. The worker reloads the YAML config.
5. The worker dynamically loads the agent class from the registry.
6. The worker rebuilds LLMs and tools.
7. Trace context and observability exporters are set up.
8. Cancellation monitoring begins.
9. The deep agent runs.
10. The callback layer emits structured events into the event store.
11. The UI and `/stream` SSE endpoint consume those events.

If Dask is not available:

- async submit/status/stream/report routes are not fully registered
- the top-level workflow falls back to synchronous deep research
- you still get observability from Phoenix, `/debug`, and logging, but not the full job-based deep research stream

Local outputs from async mode:

- jobs DB, default `./var/jobs.db`
- event store rows
- final report artifact
- SSE replayable event history

### Phase 13: Event Streaming, Debug Console, and UI Reconstruction

The structured event layer is one of the most important parts of the system.

The callback in [`frontends/aiq_api/src/aiq_api/jobs/callbacks.py`](../frontends/aiq_api/src/aiq_api/jobs/callbacks.py) emits:

- `workflow.start`
- `workflow.end`
- `llm.start`
- `llm.chunk`
- `llm.end`
- `tool.start`
- `tool.end`
- `artifact.update`
- `job.heartbeat`
- retry/update job events

Artifact types include:

- `file`
- `output`
- `citation_source`
- `citation_use`
- `todo`

This is what the UI uses to reconstruct the agent view.

#### Debug console

The backend debug console is mounted at `/debug`. It is useful for inspecting runs without the full UI.

#### UI behavior

The UI runtime is documented in [`frontends/ui/README.md`](../frontends/ui/README.md). It stores only lightweight session data in browser localStorage and lazily fetches heavyweight artifacts from the backend.

Stored in localStorage:

- session metadata
- messages
- thinking steps
- plan messages
- job IDs

Not stored in localStorage:

- final report content
- citations
- tasks
- tool calls
- agent traces
- file artifacts

Those are reloaded later using:

- report endpoint
- job state endpoint
- SSE replay

Relevant UI hooks:

- [`frontends/ui/src/features/chat/hooks/use-deep-research.ts`](../frontends/ui/src/features/chat/hooks/use-deep-research.ts)
- [`frontends/ui/src/features/chat/hooks/use-load-job-data.ts`](../frontends/ui/src/features/chat/hooks/use-load-job-data.ts)

What you actually see in the UI for a deep run:

- live job status
- agent cards
- LLM step traces
- tool call traces
- todos/tasks
- citations
- file artifacts
- final report

### Phase 14: Observability

Observability options are documented in [`docs/source/deployment/observability.md`](source/deployment/observability.md).

Practically:

- Phoenix gives you local trace trees, latency, token usage, and tool-call inspection.
- LangSmith gives cloud traces and eval-oriented history.
- verbose logging gives live console detail.
- `/debug` gives a backend inspection surface.

For your local best-visibility workflow, the effective stack is:

- Phoenix
- backend `/debug`
- UI
- optional LangSmith
- verbose logging

### Phase 15: Final Outputs and Where They Live

By the end of a research run, outputs exist in several layers.

#### Human-visible outputs

- CLI answer panel
- UI report tab
- UI citations/tasks/thinking tabs
- backend `/report` endpoint
- Phoenix traces
- `/debug`

#### Local persistent or semi-persistent outputs

- `deploy/.env`
- `.venv/`
- `.venv-phoenix/`
- `frontends/ui/node_modules/`
- `./var/jobs.db` or configured `NAT_JOB_STORE_DB_URL`
- `./var/checkpoints.db` or configured `AIQ_CHECKPOINT_DB`
- `./var/summaries.db` or configured `AIQ_SUMMARY_DB`
- `/tmp/chroma_data` or configured `AIQ_CHROMA_DIR`
- `~/.aiq/cli_history`

#### Runtime-only or virtual outputs

- session-scoped citation registry
- deep-agent virtual files:
  - `/shared/plan.json`
  - `/shared/*.txt`
  - `/report.md`
- SSE event buffers and replay state

## 4. Files Read at Runtime

### Always read

- `deploy/.env`
- selected config YAML
- plugin entry points from `pyproject.toml`

### Prompt templates read during research

- [`src/aiq_agent/agents/chat_researcher/prompts/intent_classification.j2`](../src/aiq_agent/agents/chat_researcher/prompts/intent_classification.j2)
- [`src/aiq_agent/agents/shallow_researcher/prompts/researcher.j2`](../src/aiq_agent/agents/shallow_researcher/prompts/researcher.j2)
- [`src/aiq_agent/agents/clarifier/prompts/research_clarification.j2`](../src/aiq_agent/agents/clarifier/prompts/research_clarification.j2)
- [`src/aiq_agent/agents/clarifier/prompts/plan_generation.j2`](../src/aiq_agent/agents/clarifier/prompts/plan_generation.j2)
- [`src/aiq_agent/agents/deep_researcher/prompts/planner.j2`](../src/aiq_agent/agents/deep_researcher/prompts/planner.j2)
- [`src/aiq_agent/agents/deep_researcher/prompts/researcher.j2`](../src/aiq_agent/agents/deep_researcher/prompts/researcher.j2)
- [`src/aiq_agent/agents/deep_researcher/prompts/orchestrator.j2`](../src/aiq_agent/agents/deep_researcher/prompts/orchestrator.j2)
- [`src/aiq_agent/agents/deep_researcher/prompts/source_registry.j2`](../src/aiq_agent/agents/deep_researcher/prompts/source_registry.j2)

Prompt loading is done by [`src/aiq_agent/common/prompt_utils.py`](../src/aiq_agent/common/prompt_utils.py).

### Data and state stores read during runtime

- checkpoint DB
- summary DB
- jobs/event store DB
- Chroma vector store
- uploaded temp files during ingestion
- browser localStorage in the UI

### User documents that may be ingested

Common formats:

- `.pdf`
- `.docx`
- `.txt`
- `.md`
- `.pptx` in some setups

Markdown files are not special to the workflow unless they are uploaded as documents.

## 5. Practical Workflow Before Running Research

This is the practical path I recommend if you want:

- full capability
- high observability
- easy customization later

### Step 1: Keep the local visibility stack as your default dev mode

Use:

```bash
cd /path/to/aiq
./scripts/start_visibility_stack.sh --config_file configs/config_frontier_models_visibility.yml
```

Use the LlamaIndex visibility config instead if you want to avoid OpenAI temporarily:

```bash
./scripts/start_visibility_stack.sh --config_file configs/config_web_visibility_llamaindex.yml
```

Use this mode when you are inspecting prompts, tool calls, trace trees, and routing logic.

Do not confuse it with the full async deep-research stack. For the full async path, you also need Dask.

### Step 1B: Decide whether you need full async deep-research jobs

There are two useful modes:

1. Inline visibility mode:
   - easiest local development path
   - best for architecture learning and prompt tuning
   - Phoenix, `/debug`, UI, and logs still work
   - deep research may run synchronously if Dask is absent
2. Full async deep-research mode:
   - needed if you want the exact job-submit, SSE replay, cancellation, and job-state workflow
   - requires Dask plus a job store
   - easiest packaged path is Docker Compose

If you want the full async job path, the cleanest route is:

```bash
cd /path/to/aiq/deploy/compose
docker compose --env-file ../.env -f docker-compose.yaml up -d --build
```

Convenience wrapper:

```bash
cd /path/to/aiq
./scripts/start_docker_full_stack.sh --with-phoenix
```

Why this matters:

- the compose backend uses [`deploy/entrypoint.py`](../deploy/entrypoint.py)
- that entrypoint starts `dask-scheduler`
- then starts `dask-worker`
- then exports `NAT_DASK_SCHEDULER_ADDRESS`
- then launches the web server

### Step 2: Make sure your environment is complete

Minimum practical keys for your preferred hybrid setup:

- `NVIDIA_API_KEY`
- `TAVILY_API_KEY`
- `OPENAI_API_KEY`
- `SERPER_API_KEY`

Recommended visibility keys:

- `PHOENIX_API_KEY` only if your Phoenix deployment requires it
- `PHOENIX_COLLECTOR_ENDPOINT`
- `LANGCHAIN_TRACING_V2=true`
- `LANGCHAIN_API_KEY`
- `LANGCHAIN_PROJECT`

Optional:

- `WANDB_API_KEY`
- `JINA_API_KEY`

### Step 3: Decide your document strategy before running

For a small personal document corpus:

- use `llamaindex`
- keep `knowledge_search` enabled
- keep web search enabled
- keep paper search enabled if the topic is technical
- split documents into topical collections

### Step 4: Upload documents before the run if they matter

Recommended sequence:

1. create a collection
2. upload files
3. wait for ingestion completion
4. then run research against that collection

### Step 5: Prefer the UI for deep runs

Use the UI when you want:

- live agent traces
- todos
- tool-call visibility
- report + citations + thinking views
- easy resumption of async jobs

For full async-job behavior, run the stack with Dask available.

Use the CLI when you want:

- a quick single-user terminal session
- simple iterative testing
- verbose trace output without the full UI

### Step 6: Use the API when you want deterministic control

Use the async API when you want to:

- force `deep_researcher` directly
- script repeatable runs
- inspect `/stream`, `/state`, and `/report`
- benchmark different configs or prompts

## 6. Commands You Will Actually Use

### Bootstrap

```bash
cd /path/to/aiq
./scripts/setup.sh
```

### Best-visibility stack

```bash
cd /path/to/aiq
./scripts/start_visibility_stack.sh --config_file configs/config_frontier_models_visibility.yml
```

### CLI

```bash
cd /path/to/aiq
./scripts/start_cli.sh --config_file configs/config_cli_default.yml --verbose
```

### Backend only

```bash
cd /path/to/aiq
./scripts/start_server_in_debug_mode.sh --config_file configs/config_frontier_models_visibility.yml
```

### End-to-end local UI

```bash
cd /path/to/aiq
./scripts/start_e2e.sh --config_file configs/config_web_default_llamaindex.yml
```

### Full async stack with embedded Dask via Docker Compose

```bash
cd /path/to/aiq/deploy/compose
docker compose --env-file ../.env -f docker-compose.yaml up -d --build
```

Convenience wrapper:

```bash
cd /path/to/aiq
./scripts/start_docker_full_stack.sh --with-phoenix
```

### Create a collection

```bash
curl -X POST http://localhost:8000/v1/collections \
  -H "Content-Type: application/json" \
  -d '{"name":"my-topic","description":"research corpus"}'
```

### Upload documents

```bash
curl -X POST http://localhost:8000/v1/collections/my-topic/documents \
  -F "files=@/absolute/path/to/file1.pdf" \
  -F "files=@/absolute/path/to/file2.md"
```

### Poll ingestion

```bash
curl http://localhost:8000/v1/documents/<job_id>/status
```

### Submit deep research directly

```bash
curl -X POST http://localhost:8000/v1/jobs/async/submit \
  -H "Content-Type: application/json" \
  -d '{"agent_type":"deep_researcher","input":"Compare the topic thoroughly"}'
```

### Stream a job

```bash
curl -N http://localhost:8000/v1/jobs/async/job/<job_id>/stream
```

### Get final report

```bash
curl http://localhost:8000/v1/jobs/async/job/<job_id>/report
```

## 7. Knobs and Dials Worth Adjusting

The configuration surface is large, but these are the high-value controls.

### A. Model-role assignment

Files:

- [`configs/config_frontier_models_visibility.yml`](../configs/config_frontier_models_visibility.yml)
- [`docs/source/customization/configuration-reference.md`](source/customization/configuration-reference.md)

Most important knobs:

- `intent_classifier.llm`
- `clarifier_agent.llm`
- `clarifier_agent.planner_llm`
- `shallow_research_agent.llm`
- `deep_research_agent.orchestrator_llm`
- `deep_research_agent.researcher_llm`
- `deep_research_agent.planner_llm`

This is the main place to decide:

- which model thinks
- which model plans
- which model does bulk retrieval synthesis

### B. Research-depth and routing behavior

Most important knobs:

- `workflow.enable_escalation`
- `workflow.enable_clarifier`
- `workflow.use_async_deep_research`
- `workflow.max_history`

Use these when you want to make the system:

- cheaper
- more synchronous
- less interactive
- more aggressive about staying shallow

### C. Shallow-agent budget

Most important knobs:

- `shallow_research_agent.max_llm_turns`
- `shallow_research_agent.max_tool_iterations`

These control:

- how long the shallow path is allowed to search
- when it is forced to synthesize

### D. Deep-agent budget

Most important knob:

- `deep_research_agent.max_loops`

This changes how many planning/research/synthesis loops the deep path gets before it stops.

### E. Web-search behavior

Most important knobs:

- `web_search_tool.max_results`
- `web_search_tool.max_content_length`
- `advanced_web_search_tool.max_results`
- `advanced_web_search_tool.advanced_search`

These affect:

- token usage
- breadth vs detail
- retrieval cost and latency

### F. Paper-search behavior

Most important knobs:

- `paper_search_tool.max_results`
- `paper_search_tool.serper_api_key`

Use this when the topic benefits from scholar-style discovery.

### G. Knowledge-layer behavior

Most important knobs:

- `knowledge_search.backend`
- `knowledge_search.collection_name`
- `knowledge_search.top_k`
- `knowledge_search.generate_summary`
- `knowledge_search.summary_model`
- `knowledge_search.summary_db`
- `knowledge_search.chroma_dir`
- `knowledge_search.rag_url`
- `knowledge_search.ingest_url`
- `knowledge_search.timeout`
- `knowledge_search.verify_ssl`

Practical advice:

- use `llamaindex` first
- keep `top_k` modest, usually `3-5`
- keep collections topical
- turn on `generate_summary`

### H. Knowledge-ingestion extraction knobs

Environment variables:

- `AIQ_EMBED_MODEL`
- `AIQ_EMBED_BASE_URL`
- `AIQ_EXTRACT_TABLES`
- `AIQ_EXTRACT_IMAGES`
- `AIQ_EXTRACT_CHARTS`
- `AIQ_VLM_MODEL`
- `AIQ_VLM_BASE_URL`
- `AIQ_COLLECTION_TTL_HOURS`
- `AIQ_TTL_CLEANUP_INTERVAL_SECONDS`

These matter only if you care about:

- embedding model choice
- multimodal extraction
- temporary collection cleanup

### I. Persistence and scale knobs

Environment variables and config:

- `NAT_JOB_STORE_DB_URL`
- `AIQ_CHECKPOINT_DB`
- `AIQ_SUMMARY_DB`
- `front_end.db_url`
- `front_end.expiry_seconds`

Use SQLite first. Move to Postgres only when you actually need durability across multiple users or environments.

### J. Visibility knobs

Most important:

- `general.telemetry.logging.console.level`
- `general.telemetry.tracing.*`
- `workflow.verbose`
- `AIQ_VERBOSE`
- `DEBUG_PROMPTS`
- `LANGCHAIN_TRACING_V2`
- `LANGCHAIN_PROJECT`

Practical advice:

- keep Phoenix on
- keep backend `/debug` available
- use verbose logging during prompt or routing work
- use `DEBUG_PROMPTS` sparingly because prompt dumps can get noisy

## 8. Practical Recommendations

If your goal is to use the system seriously and later customize the architecture:

1. Start with `config_frontier_models_visibility.yml`.
2. Keep `llamaindex` as the knowledge backend at first.
3. Keep web search, paper search, and knowledge search all enabled.
4. Use the UI plus Phoenix as your default inspection surface.
5. Use the async API for reproducible experiments and direct deep runs.
6. Only move to `foundational_rag` when you actually need a standalone retrieval service.
7. Only move to Docker Compose once your local architecture choices are stable.

If you want the shortest version:

- use `./scripts/start_visibility_stack.sh`
- use the frontier visibility config
- upload documents into topical collections
- run deep research from the UI
- inspect traces in Phoenix and `/debug`
