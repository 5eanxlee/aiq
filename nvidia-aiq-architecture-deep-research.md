# NVIDIA AI-Q: Architecture + Concepts Deep Research

Last updated: 2026-04-05  
Audience: technically strong reader who wants to understand the system deeply, not just run it  
Scope: architecture and concepts first; deployment/setup only when it clarifies the design

This brief reverse-engineers [NVIDIA AI-Q](https://build.nvidia.com/nvidia/aiq) from NVIDIA's current public materials: the [AI-Q Blueprint 2.0.0 docs](https://docs.nvidia.com/aiq-blueprint/2.0.0/), the public [GitHub repository](https://github.com/NVIDIA-AI-Blueprints/aiq), the architecture pages in the repo docs, current [NVIDIA NeMo Agent Toolkit](https://docs.nvidia.com/nemo/agent-toolkit/latest/index.html) docs, and the current [LangGraph](https://docs.langchain.com/oss/python/langgraph/overview) and [Deep Agents](https://docs.langchain.com/oss/python/deepagents/overview) docs. The research synthesis section uses frontier papers from 2025-2026 that are directly relevant to AI-Q's choices around routing, deep research, retrieval, verification, and evaluation.

When a statement is explicitly documented by NVIDIA or LangChain, I treat it as documented behavior. When I draw a larger architectural lesson from those details, I mark it as `Inference`.

## 1. Mental Model First

### What AI-Q is

AI-Q is an open reference architecture for enterprise-style research agents. Its core move is not "multi-agent" in the abstract. Its core move is a **two-tier research architecture**:

1. Route every request through a single cheap decision point.
2. Answer simple or narrow research questions with a fast, bounded tool loop.
3. Escalate harder questions into a slower, more structured deep-research workflow.
4. Put a human clarification and optional plan approval checkpoint in front of the expensive deep path.
5. Run deterministic citation verification after research, so the output only cites sources the system actually retrieved.
6. Measure the whole thing with benchmark harnesses rather than treating prompts as untestable magic.

That is why AI-Q looks less like a single "assistant" and more like a **budgeted research control plane**.

### What AI-Q is not

AI-Q is **not** a single frontier model with tools bolted on.

AI-Q is **not** just LangGraph with an NVIDIA label. LangGraph handles orchestration, but AI-Q also relies on NeMo Agent Toolkit for configuration, component wiring, observability, evaluation, and interactive execution, and on Deep Agents for the internal deep-research worker harness.

AI-Q is **not** only web search. Its tool surface can include web search, paper search, and a pluggable Knowledge Layer that abstracts document ingestion and retrieval.

AI-Q is **not** purely autonomous by default on the deep path. The Clarifier can ask follow-up questions and optionally require the user to approve the research plan before deep research starts.

AI-Q is **not** a full semantic fact-checker. Its citation verifier proves provenance and sanitizes risky references; it does not fully solve statement-level truth verification.

### One-Page Stack Map

![AI-Q stack map](./assets/aiq-stack-map.svg)

If your renderer does not inline SVG, open the asset directly: [aiq-stack-map.svg](./assets/aiq-stack-map.svg)

Optional async mode wraps the same workflow in Dask-backed job execution and SSE progress streaming. It is a delivery mode around the workflow, not a different research architecture.

### Separate The Layers Or You Will Get Confused

| Layer | What it owns | In AI-Q |
| --- | --- | --- |
| Configuration/runtime layer | YAML configuration, component registration, builders, interactive prompts, telemetry, eval harnesses | [NeMo Agent Toolkit](https://docs.nvidia.com/nemo/agent-toolkit/latest/index.html) |
| Orchestration layer | Explicit state graph, nodes, edges, state transitions, checkpointing | [LangGraph](https://docs.langchain.com/oss/python/langgraph/overview) |
| Deep worker harness | Planner/subagent composition, task planning, internal working state, deep task execution patterns | [Deep Agents](https://docs.langchain.com/oss/python/deepagents/overview) |
| Knowledge/tool layer | Web search, paper search, RAG, document ingestion, multimodal extraction | AI-Q tools plus the [Knowledge Layer](https://docs.nvidia.com/aiq-blueprint/2.0.0/customization/knowledge-layer.html) |
| Delivery layer | CLI, web UI, FastAPI, async jobs, SSE progress streaming | AI-Q frontends and async data flow |

### The Shortest Useful Description

If you only remember one sentence, remember this:

> AI-Q is a configurable research workflow that uses NeMo to assemble the system, LangGraph to decide where a query goes, Deep Agents to run the expensive research path, and deterministic citation verification to keep the output auditable.

## 2. End-to-End Architecture Deep Dive

### 2.1 The Top-Level State Machine

The public architecture docs describe a top-level `ChatResearcherAgent` LangGraph `StateGraph` with four operational nodes: intent classifier, shallow research, clarifier, and deep research.

![AI-Q top-level routing graph](./assets/aiq-top-level-state-machine.svg)

If your renderer does not inline SVG, open the asset directly: [aiq-top-level-state-machine.svg](./assets/aiq-top-level-state-machine.svg)

This graph is the system's first major design choice. AI-Q does not begin in a general-purpose deep loop. It begins in a **routing graph**.

### 2.2 Query Lifecycle Walkthrough

| Step | Component | What happens | Why this boundary exists |
| --- | --- | --- | --- |
| 1 | Intent classifier | One LLM call classifies `meta` vs `research`, and if `research`, chooses `shallow` vs `deep`. For `meta`, it can also generate the reply directly. | Minimizes latency and avoids separate classifier chains. |
| 2 | Shallow researcher or Clarifier | Straightforward research goes to the bounded shallow loop; complex topics go to the Clarifier first. | Keeps common questions cheap and fast. |
| 3 | Shallow tool loop | A single LLM with bound tools iterates until no tool call is needed or a tool budget is exhausted. | Covers the majority of questions without paying deep-research cost. |
| 4 | Escalation check | If shallow output is empty or contains escalation-style failure phrases, the system routes to Clarifier instead of ending. | Gives the system a recovery path when "shallow" was the wrong bet. |
| 5 | Clarifier | The system asks focused follow-up questions, drafts a research plan, and can ask the user to approve it. | Turns expensive research into a governed, narrowed task. |
| 6 | Deep researcher | A Deep Agents-based orchestrator uses planner and researcher subagents to build an outline, search iteratively, fill gaps, and draft a long report. | Separates research planning from evidence gathering and keeps the deep path structured. |
| 7 | Citation verification | A deterministic post-processor checks citations against actually retrieved sources and removes unsafe or unverifiable references. | Makes provenance auditable and strips risky or fabricated citations. |
| 8 | Delivery | The result returns immediately for sync requests, or through Dask-backed async execution with SSE progress streaming for long jobs. | Supports long-running research without blocking the interactive front end. |

### 2.3 The Four Control Questions

| If you want to know... | The answer in AI-Q is... |
| --- | --- |
| Where routing happens | `intent_classifier` at the top of the LangGraph |
| Where planning happens | First in the Clarifier's plan-generation step, then again inside the Deep Researcher's planner subagent |
| Where the user can intervene | In the Clarifier's clarification loop and optional plan approval step |
| Where citations become auditable | In the post-processing pipeline that uses `SourceRegistryMiddleware`, `verify_citations()`, and report sanitization |

### 2.4 State Objects That Matter

AI-Q is easier to understand if you follow the state models rather than just the prompts.

| State model | What it carries | Why it matters |
| --- | --- | --- |
| `ChatResearcherState` | conversation history, selected data sources, user intent, depth decision, shallow result, clarifier result, original query, available documents, final report | It is the shared state for the top-level LangGraph graph. |
| `ClarifierAgentState` | conversation, clarification log, turn count, plan title, plan sections, plan approval/rejection flags, feedback history | It turns a vague user request into an approved research scope. |
| `DeepResearchAgentState` | conversation, tools info, todos, files, subagent tracking, clarification context, available documents | It shows where Deep Agents enters the picture: the deep path carries task state, virtual files, and subagent metadata. |

### 2.5 Important Naming Collision: "Orchestrator" Means Two Different Things

This is one of the easiest ways to get lost.

**Top-level orchestrator:** the `ChatResearcherAgent` LangGraph graph that decides whether the request is meta, shallow research, or deep research.

**Deep-path orchestrator:** the internal Deep Researcher orchestrator LLM that coordinates the planner subagent, researcher subagent, draft updates, citation cataloging, and final report.

They are both orchestrators, but they operate at different layers:

- The top-level orchestrator chooses **which workflow to run**.
- The deep-path orchestrator chooses **how to execute deep research once that workflow has already been chosen**.

### 2.6 Shallow Path: Fast, Bounded Research

The shallow researcher is intentionally simple:

- one LLM
- one tool-calling loop
- a configurable cap on tool usage
- forced synthesis when the budget is exhausted

Internally it is a two-node LangGraph:

- `agent`
- `tools`

The agent calls tools in parallel when possible, increments a `tool_iterations` counter, and loops until the model stops asking for tools. If the tool budget is exhausted, AI-Q appends a synthesis anchor that explicitly tells the model to stop researching and produce the final answer with citations.

This is a very pragmatic design. AI-Q does not try to make shallow research "smart enough" to cover every case. It just tries to make it **cheap, bounded, and recoverable**.

### 2.7 Escalation Is A Heuristic, Not Magic

After shallow research, AI-Q can escalate to deep research if:

- the answer is empty, or
- the tail of the answer contains failure-like phrases such as "unable to find," "need more research," or "I don't have enough information."

That matters because AI-Q's shallow/deep split is only useful if the system can recover from misrouting. But it also matters because the recovery logic is heuristic. It is not a learned confidence model.

`Inference:` This is a strong engineering tradeoff, but also a natural future pressure point. As deep-research systems mature, escalation will likely move from phrase heuristics toward explicit uncertainty estimation, judge models, or retrieval-aware confidence signals.

### 2.8 Clarifier: HITL As Compute Governance

The Clarifier is not just a UX nicety. It is a governance layer for expensive research.

It can:

- ask up to a bounded number of clarification questions,
- collect answers into a clarification log,
- generate a plan title and section list,
- request explicit approval or revision of the plan,
- pass approved plan context into the deep-research prompt.

This means AI-Q treats deep research as something that should often be **scoped before it is executed**, not merely "called."

That is a meaningful architectural statement. In AI-Q, human-in-the-loop exists not only for safety but also for **compute efficiency and task definition**.

### 2.9 Deep Researcher: Structured Long-Horizon Research

The deep researcher runs a multi-phase workflow:

1. Load orchestrator prompt plus any clarification context.
2. Dispatch to a planner subagent.
3. Have the planner build an evidence-grounded outline and a set of strategic search queries.
4. Enter research loops, where a researcher subagent gathers evidence and the orchestrator updates the draft and identifies gaps.
5. Catalog citations.
6. Produce the final polished report.
7. Run citation verification as post-processing.

Three roles matter here:

| Role | Job |
| --- | --- |
| Orchestrator | coordinates the whole deep loop, updates the draft, catalogs citations, emits the final report |
| Planner subagent | turns the question into sections and search strategy |
| Researcher subagent | runs the evidence-gathering searches and synthesizes what was found |

By default, the planner generates 4-6 strategic queries mapped to report sections, and the orchestrator runs a small number of research loops, with `max_loops` defaulting to `2`.

This is not infinite autonomous browsing. It is **bounded long-horizon research**.

### 2.10 Citation Verification: Provenance, Not Full Truth

The citation verifier is one of the most important ideas in AI-Q.

AI-Q records retrieved sources during research through a `SourceRegistryMiddleware`. After the model writes a report, `verify_citations()` checks each citation against what was actually retrieved. The matching logic is intentionally more forgiving than exact-string equality:

- exact or normalized URL match
- truncation or prefix match
- child-path match
- query-subset match
- lenient handling for knowledge-layer citation keys such as `report.pdf, p.15`

Then `sanitize_report()` removes unsafe or unreliable URLs, including:

- shortened URLs
- truncated or garbled URLs
- IP-address URLs
- non-HTTP schemes like `javascript:` or `file:`

Finally, citations are renumbered so the output stays coherent.

This gives AI-Q a clear property:

> every surviving citation should correspond to something the system actually retrieved.

That is very useful, but it is not the same as proving the cited sentence is semantically correct. AI-Q verifies **provenance and reference hygiene**, not end-to-end truth.

### 2.11 Async Delivery: Dask + SSE

AI-Q's data-flow docs show a separate async path for long research jobs:

- FastAPI receives the submission.
- A job store records the task.
- Dask workers run the agent workflow.
- Intermediate events are stored.
- SSE streams progress back to the client.

This is important because deep research is operationally different from chat. AI-Q treats it as a **job system with progress events**, not merely a long HTTP response.

## 3. Concepts From First Principles

This section teaches the major ideas twice:

- first generically
- then in AI-Q's concrete form

### 3.1 LangGraph State Graphs

**Generic idea:** A state graph is an explicit workflow where nodes read and write shared state, and edges determine what happens next. The big advantage over a single opaque agent loop is that routing logic becomes inspectable and testable.

**In AI-Q:** The top-level `ChatResearcherAgent` is a LangGraph `StateGraph` over `ChatResearcherState`. It has explicit nodes for intent classification, shallow research, clarification, and deep research. The shallow researcher is itself another smaller LangGraph with `agent` and `tools` nodes. So AI-Q uses LangGraph twice:

- once for top-level routing
- once for bounded tool-calling in the shallow path

### 3.2 Message Reducers And Shared State

**Generic idea:** Long-running agent workflows need state that survives across turns, tool calls, and branches. Reducers define how that state is updated without losing the prior conversation.

**In AI-Q:** Several state models use LangGraph's message reducer pattern, so `messages` accumulates conversation and tool traces over time. The top-level state also holds routing decisions like `user_intent` and `depth_decision`, while deep-research state carries richer working memory like `todos`, `files`, and `subagents`.

### 3.3 Bounded Tool-Calling Loops

**Generic idea:** Tool-using agents can spiral into wasteful loops if they are not budgeted. A bounded loop limits cost and latency while still allowing iterative evidence gathering.

**In AI-Q:** The shallow researcher counts tool calls with `tool_iterations` and stops after `max_tool_iterations`. When the budget is exhausted, AI-Q appends a synthesis anchor telling the model to stop calling tools and write the answer. This is a concrete anti-runaway mechanism.

### 3.4 Planner/Researcher Decomposition

**Generic idea:** Long-horizon research benefits from separating "how should I attack this question?" from "go fetch and summarize evidence for this subproblem." That prevents the same model loop from constantly switching between planning, searching, and writing.

**In AI-Q:** The deep path uses a planner subagent to generate an evidence-grounded outline and strategic queries, then a researcher subagent to gather evidence, while an orchestrator updates the report draft and decides what gaps remain. AI-Q therefore decomposes deep research into:

- planning
- evidence collection
- synthesis

### 3.5 HITL Plan Approval

**Generic idea:** Human-in-the-loop can mean many things: approval, correction, escalation, or supervision. In research systems, it often matters most before expensive work begins.

**In AI-Q:** The Clarifier uses NeMo Agent Toolkit's interactive workflow machinery to ask follow-up questions and optionally require explicit plan approval. This is not post-hoc review. It is **pre-execution scope control**.

### 3.6 Middleware

**Generic idea:** Middleware is where you put cross-cutting behavior that should wrap many calls without being hardcoded into every tool or every agent. Typical examples are retries, tracing, validation, and normalization.

**In AI-Q:** The deep path uses a shared middleware stack including:

- `EmptyContentFixMiddleware`
- `ToolNameSanitizationMiddleware`
- `ModelRetryMiddleware`
- `SourceRegistryMiddleware`

This is a strong sign of production-minded design. The interesting behavior is not only inside prompts; it is also in the wrappers around model and tool execution.

### 3.7 Source Registries And Deterministic Verification

**Generic idea:** If an agent can cite arbitrary links it never retrieved, provenance collapses. A source registry gives the system ground truth about what evidence was actually seen.

**In AI-Q:** Every tool result that exposes URLs or citation keys is recorded into a session-specific source registry. Later, citation verification uses that registry as the authoritative reference set. This is why AI-Q can prune hallucinated or unsafe citations after generation.

### 3.8 Knowledge Layer / RAG Abstraction

**Generic idea:** Retrieval can become a maintenance nightmare if the rest of the system is tightly coupled to one vector store or one ingestion pipeline. An abstraction layer separates retrieval semantics from backend choice.

**In AI-Q:** The Knowledge Layer is a pluggable document ingestion and retrieval abstraction. The versioned docs describe:

- a common `Chunk`-style output schema,
- ingestion job tracking,
- collection and file management,
- local `llamaindex` mode,
- hosted `foundational_rag` mode.

The key design consequence is that the same agents can search user documents through either a lightweight local backend or a hosted RAG Blueprint without changing the core orchestration code.

### 3.9 Deep Agents As A Harness

**Generic idea:** A harness is not the same as an orchestrator. A harness gives you recurring capabilities such as subagents, working memory, task planning, or file abstractions so you do not have to build those patterns from scratch every time.

**In AI-Q:** NVIDIA's docs describe the Deep Researcher as being built with `create_deep_agent` from LangChain's Deep Agents library. The Deep Agents docs describe the harness as providing task planning, subagents, filesystem-backed context management, and memory. AI-Q's deep state exposes this influence directly through fields like `todos`, `files`, and `subagents`, and through the planner/researcher subagent structure. In other words, AI-Q does not implement the deep path as hand-written LangGraph nodes; it uses Deep Agents as the internal execution substrate for that part of the system.

### 3.10 Async Jobs And Streaming

**Generic idea:** Research tasks are long enough that they should be modeled as jobs, not only as request-response RPCs. Once you do that, you also need job states, cancellation, and progress events.

**In AI-Q:** The data-flow docs show job states such as `SUBMITTED`, `RUNNING`, `SUCCESS`, `FAILURE`, and `INTERRUPTED`, with Dask workers performing execution and SSE delivering progress. AI-Q therefore treats deep research as an **operational workflow**, not merely a model call.

### 3.11 Evaluation Harnesses

**Generic idea:** If you cannot evaluate a research workflow, you will tune it by feel. That usually leads to brittle prompt iteration and unverifiable claims about quality.

**In AI-Q:** NVIDIA ships benchmark harnesses for at least:

- [FreshQA](https://github.com/freshllms/freshqa), for factual freshness and correctness
- [DeepResearch Bench](https://github.com/Ayanami0730/deep_research_bench/tree/main), for long-form report quality and citation grounding

That matters because the official AI-Q docs explicitly say defaults such as escalation thresholds and research loop counts are tuned through benchmark performance.

### 3.12 NeMo Agent Toolkit As The Assembly Layer

**Generic idea:** A good agent system needs more than prompts and graphs. It needs a way to assemble components, swap models, enable or disable tools, support interactive execution, observe traces, and run evaluations from configuration.

**In AI-Q:** NeMo Agent Toolkit is that assembly layer. NVIDIA's docs describe workflow YAML as the single source of truth for `functions`, `llms`, `embedders`, and `workflow`, and also show that NeMo can wrap existing LangGraph agents with configuration management, observability, and evaluation. AI-Q leans on this heavily:

- tools are enabled or disabled via YAML lists,
- knowledge retrieval is registered as a NeMo function type,
- HITL uses NeMo interactive workflows,
- benchmark execution uses `nat eval`,
- hybrid model examples swap fast-path and deep-path LLMs through config rather than code changes.

## 4. Frontier Research Synthesis

This section is intentionally narrow. I only include research that materially sharpens understanding of AI-Q.

### 4.1 Paper-Synthesis Matrix

| Lane | Representative papers | Core idea | What problem it solves | AI-Q status |
| --- | --- | --- | --- | --- |
| Benchmark and evaluation | [DeepResearch Bench](https://arxiv.org/abs/2506.11763), [DeepResearch Bench II](https://arxiv.org/abs/2601.08536), [DeepResearchEval](https://arxiv.org/abs/2601.09688), [FreshLLMs / FreshQA](https://arxiv.org/abs/2310.03214) | Deep-research agents need richer evaluation than short QA; report quality, citation quality, freshness, and factuality must be measured separately. | Stops teams from tuning only for vibes or only for retrieval counts. | **Embodied strongly.** AI-Q ships benchmark harnesses and clearly designs around evaluation. |
| Open deep-research systems | [DeepResearcher](https://arxiv.org/abs/2504.03160), [WebDancer](https://arxiv.org/abs/2505.22648), [Deep Research Agents: A Systematic Examination and Roadmap](https://arxiv.org/abs/2506.18096) | Long-horizon research needs planning, search, synthesis, and explicit treatment of real-world retrieval constraints. | Moves beyond single-turn RAG or prompt-engineered browsing. | **Partially embodied.** AI-Q has the structure, but its loops are conservative and bounded. |
| Retrieval and reasoning | [AgentIR](https://arxiv.org/abs/2603.04384), [DeepResearcher](https://arxiv.org/abs/2504.03160) | Retrieval quality improves when it conditions on the agent's evolving reasoning and gaps, not just raw queries. | Reduces ambiguous search and under-specified retrieval. | **Partially embodied.** AI-Q rewrites shallow web queries and lets planner/researcher refine searches, but it does not yet expose a dedicated reasoning-aware retriever layer. |
| Verification-centric design | [Marco DeepResearch](https://arxiv.org/abs/2603.28376), [DeepResearchEval](https://arxiv.org/abs/2601.09688), [DeepResearch Bench II](https://arxiv.org/abs/2601.08536) | Verification should exist in data creation, trajectory building, retrieval, and test-time execution, not only in final citations. | Prevents early mistakes from compounding through a long research chain. | **Embodied partially.** AI-Q is strong on final citation provenance, weaker on intermediate-step semantic verification. |

### 4.2 Benchmark And Evaluation Papers

The evaluation lane explains a lot about why AI-Q looks the way it does.

#### DeepResearch Bench

[DeepResearch Bench](https://arxiv.org/abs/2506.11763) is a foundational benchmark for long-form deep-research agents. The AI-Q benchmark docs describe it as a 100-task benchmark with RACE and FACT metrics. RACE focuses on report quality dimensions such as comprehensiveness, insight, instruction following, and readability. FACT focuses on effective citations and citation accuracy.

Why this matters for AI-Q:

- it legitimizes long-form report evaluation as a separate problem from short QA
- it rewards systems that can cite well, not just retrieve a lot
- it pushes architecture toward auditable outputs rather than only answer strings

AI-Q clearly absorbs this worldview. Its deep path is built to produce sectioned reports with citations, and its post-processing is citation-aware by design.

#### DeepResearch Bench II

[DeepResearch Bench II](https://arxiv.org/abs/2601.08536) pushes evaluation further by using expert-derived rubrics from real investigative reports. The important lesson is that coarse metrics are not enough; deep research should be scored across fine-grained dimensions such as information recall, analysis, and presentation.

Why this matters for AI-Q:

- AI-Q is already benchmark-oriented
- but the next wave of evaluation is more diagnostic and more expert-grounded

`Inference:` If AI-Q evolves in the direction the field is moving, its future eval harnesses will likely need more rubric-driven and statement-level evaluation, not only aggregate benchmark scores.

#### DeepResearchEval

[DeepResearchEval](https://arxiv.org/abs/2601.09688) is important because it argues for:

- automatically generated research tasks
- task-adaptive quality dimensions
- active fact-checking of statements, not just citation formatting

This is exactly the paper that reveals AI-Q's current boundary: AI-Q is strong on provenance verification, but it does not yet implement a full active fact-checking loop over every claim in the final report.

#### FreshLLMs / FreshQA

[FreshLLMs](https://arxiv.org/abs/2310.03214) and the [FreshQA](https://github.com/freshllms/freshqa) benchmark focus on up-to-date factual correctness, false-premise handling, and time-sensitive QA. AI-Q includes a FreshQA evaluator, which makes sense because freshness is a natural failure mode for shallow research and current-events search.

The lesson is simple:

> if a research system touches the live web, temporal correctness is part of the architecture, not just part of the prompt.

### 4.3 Open Deep-Research Systems

#### DeepResearcher

[DeepResearcher](https://arxiv.org/abs/2504.03160) is one of the clearest open papers on training an agent to do deep research in real web environments rather than a frozen local RAG setting. The paper emphasizes reinforcement learning in live web environments and reports emergent behaviors such as planning, cross-validation, self-reflection, and honesty.

Why it matters for AI-Q:

- it validates AI-Q's assumption that deep research is a distinct regime, not just "more search"
- it highlights that search behavior itself can be trained rather than only prompted
- it suggests that richer verification and query refinement can emerge from training, not only hand-engineered loops

AI-Q today is mostly an engineered workflow. DeepResearcher points toward a future where more of AI-Q's routing, retrieval, and self-checking behavior becomes learned.

#### WebDancer

[WebDancer](https://arxiv.org/abs/2505.22648) is a data-centric and training-centric system for autonomous information-seeking agents. It emphasizes:

- constructing difficult browsing datasets,
- generating high-quality trajectories,
- combining SFT and RL for agent behavior.

Why it matters for AI-Q:

- AI-Q is currently strongest as a reference workflow and eval harness
- WebDancer shows the complementary layer: how to train the models or policies that make those workflows work better in the wild

`Inference:` AI-Q and WebDancer sit on opposite sides of the same problem. AI-Q is the workflow/control-plane side. WebDancer is the behavior-learning side.

#### Systematic Examination And Roadmap

[Deep Research Agents: A Systematic Examination and Roadmap](https://arxiv.org/abs/2506.18096) is useful because it classifies deep-research systems by planning style, agent composition, information acquisition method, and evaluation gaps.

That survey helps explain why AI-Q's design is not arbitrary:

- AI-Q uses a **dynamic workflow**
- it combines **routing plus specialized agents**
- it uses **API-based tools** by default, not only browser automation
- it makes HITL optional but structurally present

In other words, AI-Q is close to the canonical 2025-2026 open deep-research architecture.

### 4.4 Retrieval And Reasoning

#### AgentIR

[AgentIR](https://arxiv.org/abs/2603.04384) argues that retrieval for deep-research agents should use the agent's reasoning trace, not only its next query string. That is a very important idea.

Why it matters for AI-Q:

- shallow AI-Q already includes query rewriting when web search is available
- deep AI-Q already has a planner that produces strategic queries
- but AI-Q does not yet expose a dedicated reasoning-aware retrieval layer that jointly uses explicit thought state and query state

This is a likely next step for AI-Q's Knowledge Layer or tool wrappers. If retrieval becomes reasoning-aware, the gap between "planner" and "retriever" gets tighter.

#### Search As A Learned Capability

DeepResearcher and related papers make a broader point: long-horizon search quality is not only a function of the final LLM. It also depends on whether the system:

- asks the right intermediate questions,
- revises search strategy after weak evidence,
- cross-validates conflicting sources,
- knows when not to overclaim.

AI-Q already approximates some of this with:

- planner/researcher separation
- multi-loop draft gap analysis
- escalation from shallow to deep
- provenance-based citation verification

But the literature suggests that future gains come from **tighter reasoning-retrieval coupling**, not just better prompts.

### 4.5 Verification-Centric Design

#### Marco DeepResearch

[Marco DeepResearch](https://arxiv.org/abs/2603.28376) is one of the clearest articulations of a verification-centric philosophy. The key claim is that verification should not be bolted on only at the end. It should shape:

- synthetic data generation
- trajectory construction
- test-time scaling

That maps neatly onto AI-Q because AI-Q already takes verification more seriously than many open systems. But AI-Q mainly verifies **final citations**. Marco DeepResearch argues that future deep-research systems should also verify intermediate steps and alternative trajectories.

#### What AI-Q Already Does Well

AI-Q's citation pipeline is stronger than the common "hope the model cited honestly" pattern. It:

- records retrieved sources,
- matches citations back to those sources,
- removes unsafe or unverifiable references,
- preserves an audit trail.

That is a real architectural advantage.

#### What The Newer Verification Literature Suggests

The newer papers suggest AI-Q's next verification frontier is not just better citation hygiene. It is **statement-level and trajectory-level verification**:

- did this sentence follow from the cited page?
- did the system ignore contradictory evidence?
- should it have revisited an earlier branch?
- did it converge too early?

`Inference:` AI-Q's provenance verification is already a strong base. The likely upgrade path is to add semantic verification on top of it, not to replace it.

## 5. AI-Q Design Critique

This section is intentionally sober. AI-Q is a strong reference architecture, but the design tradeoffs are visible.

### 5.1 What AI-Q Gets Right

#### The shallow/deep split is economically correct

Most user queries do not deserve full deep research. AI-Q's routing graph acknowledges that directly. The hybrid frontier-model example in the official docs makes the same point operationally: use fast, cheaper NIM-backed models for intent and shallow research, and reserve a stronger frontier model for the deep path.

This is a very practical architecture for real systems where latency and cost matter.

#### The Clarifier is more important than it looks

Many systems treat clarification as a chat-quality feature. AI-Q treats it as research governance. That is the better framing for long-running research tasks.

#### The citation verifier is a real differentiator

Open systems frequently stop at "the model produced links." AI-Q adds a deterministic provenance layer after generation. That is a concrete step from assistant behavior toward auditable workflow behavior.

#### The system is benchmark-native

AI-Q is not just a demo repo. It is designed to be measured. That is one of the strongest signals that the architecture is meant to evolve through evaluation instead of prompt folklore.

#### The layering is clean

NeMo assembles and observes the workflow. LangGraph routes it. Deep Agents runs the deep path. The Knowledge Layer abstracts document retrieval. This is a good division of responsibilities.

### 5.2 Likely Bottlenecks And Failure Modes

| Bottleneck | Why it happens in AI-Q | What newer work suggests |
| --- | --- | --- |
| Routing brittleness | One LLM call decides meta vs research and shallow vs deep. Misclassification is cheap but can be costly downstream. | Confidence-aware routing, judge models, or lightweight pre-routing clarification for ambiguous cases. |
| Heuristic escalation | Escalation from shallow depends on emptiness and failure-like phrases in the answer tail. | Learned uncertainty or retrieval-aware confidence signals. |
| Retrieval dependence | If Tavily, Serper, or the Knowledge Layer misses the right evidence, the report quality is capped before reasoning even begins. | Reasoning-aware retrieval and stronger search-policy learning. |
| Conservative deep loops | Default `max_loops=2` keeps cost controlled but may underserve broad or conflict-heavy topics. | Adaptive compute, richer loop budgeting, or verifier-guided test-time scaling. |
| Provenance without full semantic verification | A citation can be real and still fail to support the surrounding sentence strongly enough. | Statement-level fact-checking and verifier subagents. |
| Tool abstraction leakage | YAML configurability is powerful, but complex tool sets can make agent behavior harder to reason about and tune. | Better tool scoring, capability tagging, and per-route tool policies. |
| Benchmark overfitting | Tuning architecture knobs to benchmark success can improve scores without fully matching user utility. | Live or user-centric benchmarks and more diverse rubric-based evaluation. |
| Operational complexity | Dask jobs, SSE streams, telemetry, and multiple agent layers are more powerful than a single loop, but also harder to run and debug. | Better observability, failure replay, and job-level introspection. |

### 5.3 The Most Important Architectural Tension

AI-Q lives at the intersection of three competing goals:

1. low latency and low cost for common queries
2. rich long-horizon research for complex queries
3. auditable provenance for everything that survives to the user

Its architecture is essentially a truce between those goals.

`Inference:` That is why the system feels layered and cautious instead of fully autonomous. AI-Q is not trying to maximize raw agent freedom. It is trying to maximize **useful research under controllable budget and controllable provenance**.

### 5.4 Where I Would Expect AI-Q To Evolve

If AI-Q follows the direction of the 2025-2026 literature, the next upgrades are likely to be:

- confidence-aware routing instead of phrase-based escalation alone
- reasoning-aware retrieval in the knowledge layer or search wrappers
- statement-level verification on top of citation provenance
- adaptive deep-loop budgets instead of a mostly fixed loop count
- more expert-grounded and task-adaptive evaluation
- more explicit support for parallel or DAG-like deep-research branches

The good news is that AI-Q's current structure is compatible with all of those. The graph, middleware, verification, and eval harnesses already give it natural insertion points.

## 6. Glossary

| Term | Meaning in AI-Q |
| --- | --- |
| AI-Q | NVIDIA's open reference blueprint for research-oriented AI agents |
| NeMo Agent Toolkit | The configuration/runtime/evaluation layer that wires the workflow together |
| LangGraph | The explicit graph runtime used for orchestration and stateful workflows |
| Deep Agents | The agent harness used by AI-Q's deep researcher for planner/subagent execution |
| ChatResearcher | The top-level orchestration workflow over `ChatResearcherState` |
| Intent classifier | The entry node that decides meta vs research and shallow vs deep in one LLM call |
| Shallow researcher | Fast, bounded tool-augmented research path for simpler questions |
| Escalation | The route from shallow to Clarifier when shallow output looks insufficient |
| Clarifier | HITL agent that asks follow-ups and can require plan approval before deep research |
| Deep researcher | Multi-phase long-horizon research workflow using orchestrator, planner, and researcher roles |
| Knowledge Layer | Pluggable ingestion and retrieval abstraction for document-backed search |
| Source registry | Session-level record of URLs and citation keys actually retrieved during research |
| Citation verification | Deterministic post-processing that validates citations against the source registry |
| RACE | DeepResearch Bench metric family for report-quality evaluation |
| FACT | DeepResearch Bench metric family for citation effectiveness and citation accuracy |
| Dask/SSE | AI-Q's async execution and progress-streaming infrastructure for long-running jobs |

## 7. What To Internalize

1. AI-Q's defining idea is **tiered research orchestration**, not generic "multi-agent" branding.

2. The system has three distinct technical layers:

   - NeMo assembles and governs the workflow.
   - LangGraph routes and persists state.
   - Deep Agents powers the deep worker harness.

3. The Clarifier is there because deep research is expensive and ambiguous, not because NVIDIA wanted a nicer conversation.

4. The shallow path is designed to be wrong safely. It is cheap by default and can escalate when it fails.

5. AI-Q's citation system is a genuine architectural commitment to provenance, but provenance is not the same as full factual verification.

6. AI-Q already reflects the main 2025-2026 deep-research pattern:

   - route cheap
   - escalate deliberately
   - plan before going long
   - iterate on evidence
   - verify what you cite
   - evaluate continuously

7. The frontier papers do not overturn AI-Q's architecture. They mostly point to where the next upgrades should land inside it.

## 8. Primary Sources And Frontier Papers

### NVIDIA / project sources

- [NVIDIA AI-Q build page](https://build.nvidia.com/nvidia/aiq)
- [AI-Q Blueprint 2.0.0 docs index](https://docs.nvidia.com/aiq-blueprint/2.0.0/)
- [AI-Q GitHub repository](https://github.com/NVIDIA-AI-Blueprints/aiq)
- [Architecture overview (repo docs)](https://github.com/NVIDIA-AI-Blueprints/aiq/blob/develop/docs/source/architecture/overview.md)
- [Intent classifier (repo docs)](https://raw.githubusercontent.com/NVIDIA-AI-Blueprints/aiq/refs/heads/develop/docs/source/architecture/agents/intent-classifier.md)
- [Clarifier agent (repo docs)](https://raw.githubusercontent.com/NVIDIA-AI-Blueprints/aiq/refs/heads/develop/docs/source/architecture/agents/clarifier.md)
- [Shallow researcher (repo docs)](https://raw.githubusercontent.com/NVIDIA-AI-Blueprints/aiq/refs/heads/develop/docs/source/architecture/agents/shallow-researcher.md)
- [Deep researcher (repo docs)](https://raw.githubusercontent.com/NVIDIA-AI-Blueprints/aiq/refs/heads/develop/docs/source/architecture/agents/deep-researcher.md)
- [Data flow (repo docs)](https://raw.githubusercontent.com/NVIDIA-AI-Blueprints/aiq/refs/heads/develop/docs/source/architecture/data-flow.md)
- [Code organization](https://docs.nvidia.com/aiq-blueprint/2.0.0/contributing/code-organization.html)
- [Tools and sources](https://docs.nvidia.com/aiq-blueprint/2.0.0/customization/tools-and-sources.html)
- [Knowledge Layer](https://docs.nvidia.com/aiq-blueprint/2.0.0/customization/knowledge-layer.html)
- [Human-in-the-loop](https://docs.nvidia.com/aiq-blueprint/2.0.0/customization/hitl.html)
- [Hybrid frontier model example](https://docs.nvidia.com/aiq-blueprint/2.0.0/examples/hybrid-frontier-model.html)
- [Deep Research Bench evaluation page (repo docs)](https://raw.githubusercontent.com/NVIDIA-AI-Blueprints/aiq/refs/heads/develop/docs/source/evaluation/benchmarks/deep-research-bench.md)
- [FreshQA evaluator page (repo docs)](https://raw.githubusercontent.com/NVIDIA-AI-Blueprints/aiq/refs/heads/develop/docs/source/evaluation/benchmarks/freshqa.md)

### Framework sources

- [NeMo Agent Toolkit overview](https://docs.nvidia.com/nemo/agent-toolkit/latest/index.html)
- [NeMo workflow configuration](https://docs.nvidia.com/nemo/agent-toolkit/latest/build-workflows/workflow-configuration.html)
- [NeMo interactive workflows](https://docs.nvidia.com/nemo/agent-toolkit/latest/build-workflows/advanced/interactive-workflows.html)
- [NeMo middleware](https://docs.nvidia.com/nemo/agent-toolkit/latest/build-workflows/advanced/middleware.html)
- [NeMo LangGraph wrapper](https://docs.nvidia.com/nemo/agent-toolkit/latest/run-workflows/existing-agents/langgraph.html)
- [LangGraph overview](https://docs.langchain.com/oss/python/langgraph/overview)
- [Deep Agents overview](https://docs.langchain.com/oss/python/deepagents/overview)

### Frontier papers

- [DeepResearch Bench: A Comprehensive Benchmark for Deep Research Agents](https://arxiv.org/abs/2506.11763)
- [DeepResearch Bench II: Diagnosing Deep Research Agents via Rubrics from Expert Report](https://arxiv.org/abs/2601.08536)
- [DeepResearchEval: An Automated Framework for Deep Research Task Construction and Agentic Evaluation](https://arxiv.org/abs/2601.09688)
- [FreshLLMs: Refreshing Large Language Models with Search Engine Augmentation](https://arxiv.org/abs/2310.03214)
- [DeepResearcher: Scaling Deep Research via Reinforcement Learning in Real-world Environments](https://arxiv.org/abs/2504.03160)
- [WebDancer: Towards Autonomous Information Seeking Agency](https://arxiv.org/abs/2505.22648)
- [Deep Research Agents: A Systematic Examination and Roadmap](https://arxiv.org/abs/2506.18096)
- [AgentIR: Reasoning-Aware Retrieval for Deep Research Agents](https://arxiv.org/abs/2603.04384)
- [Marco DeepResearch: Unlocking Efficient Deep Research Agents via Verification-Centric Design](https://arxiv.org/abs/2603.28376)
