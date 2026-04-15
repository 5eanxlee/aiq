// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { NextRequest, NextResponse } from 'next/server'
import { parse, stringify } from 'yaml'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type ReloadState =
  | 'idle'
  | 'scheduled'
  | 'validating'
  | 'stopping'
  | 'starting'
  | 'rolling_back'
  | 'rolled_back'
  | 'ready'
  | 'failed'

interface LocalStackState {
  CONFIG_FILE?: string
  BACKEND_PORT?: string
  FRONTEND_PORT?: string
  NEXT_PORT?: string
  BACKEND_LOG?: string
  FRONTEND_LOG?: string
}

interface ReloadStatusPayload {
  operation_id: string | null
  state: ReloadState
  message: string
  error: string | null
  config_path: string | null
  previous_config_path: string | null
  backend_url: string | null
  frontend_url: string | null
  log_path: string | null
  rollback_attempted: boolean
  rollback_succeeded: boolean
  updated_at: string
}

interface ResearchOptionsPayload {
  supported: boolean
  local_stack_running: boolean
  can_edit: boolean
  requires_reload: boolean
  config_path: string | null
  generated_config_path: string | null
  knowledge_layer_enabled: boolean
  generate_summary: boolean
  top_k: number
  min_total_sources_retrieved: number
  min_total_cited_sources: number
  notes: string[]
}

interface ApplyResearchOptionsRequest {
  knowledge_layer_enabled?: boolean
  generate_summary?: boolean
  top_k?: number
  min_total_sources_retrieved?: number
  min_total_cited_sources?: number
}

const findProjectRoot = (): string => {
  const candidates = [
    process.cwd(),
    path.resolve(process.cwd(), '..'),
    path.resolve(process.cwd(), '../..'),
    path.resolve(process.cwd(), '../../..'),
  ]

  for (const candidate of candidates) {
    if (
      existsSync(path.join(candidate, 'scripts', 'restart_local_backend.sh')) &&
      existsSync(path.join(candidate, 'configs'))
    ) {
      return candidate
    }
  }

  throw new Error('Unable to locate the AI-Q project root from the frontend runtime.')
}

const PROJECT_ROOT = findProjectRoot()
const RUN_DIR = path.join(PROJECT_ROOT, 'var', 'run')
const STATUS_FILE = path.join(RUN_DIR, 'backend-reload-status.json')
const STATE_FILE = path.join(RUN_DIR, 'local-stack.env')
const CONFIGS_DIR = path.join(PROJECT_ROOT, 'configs')
const RESTART_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'restart_local_backend.sh')

const KNOWLEDGE_TOOL_CONSUMERS = [
  'intent_classifier',
  'clarifier_agent',
  'shallow_research_agent',
  'deep_research_agent',
] as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

const parseEnvFile = (content: string): Record<string, string> => {
  const values: Record<string, string> = {}

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }

    const separatorIndex = line.indexOf('=')
    if (separatorIndex <= 0) {
      continue
    }

    const key = line.slice(0, separatorIndex).trim()
    const value = line.slice(separatorIndex + 1).trim()
    values[key] = value
  }

  return values
}

const readLocalStackState = async (): Promise<LocalStackState | null> => {
  if (!(await fileExists(STATE_FILE))) {
    return null
  }

  const content = await fs.readFile(STATE_FILE, 'utf8')
  return parseEnvFile(content)
}

const statusFromState = (
  state: LocalStackState | null,
  overrides: Partial<ReloadStatusPayload> = {}
): ReloadStatusPayload => {
  const backendPort = state?.BACKEND_PORT ?? '8000'
  const frontendPort = state?.FRONTEND_PORT ?? '3005'
  const backendLog = state?.BACKEND_LOG ?? path.join(PROJECT_ROOT, 'var', 'logs', 'backend.log')

  return {
    operation_id: null,
    state: 'idle',
    message: 'No backend reload is currently in progress.',
    error: null,
    config_path: state?.CONFIG_FILE ?? null,
    previous_config_path: state?.CONFIG_FILE ?? null,
    backend_url: `http://localhost:${backendPort}`,
    frontend_url: `http://localhost:${frontendPort}`,
    log_path: backendLog,
    rollback_attempted: false,
    rollback_succeeded: false,
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

const readReloadStatus = async (): Promise<ReloadStatusPayload> => {
  const state = await readLocalStackState()

  if (!(await fileExists(STATUS_FILE))) {
    return statusFromState(state)
  }

  try {
    const content = await fs.readFile(STATUS_FILE, 'utf8')
    const parsed = JSON.parse(content) as Partial<ReloadStatusPayload>
    return statusFromState(state, parsed)
  } catch {
    return statusFromState(state, {
      state: 'failed',
      message: 'The local reload status file could not be parsed.',
      error: `Status file is unreadable: ${STATUS_FILE}`,
    })
  }
}

const writeReloadStatus = async (payload: ReloadStatusPayload): Promise<void> => {
  await fs.mkdir(RUN_DIR, { recursive: true })
  await fs.writeFile(STATUS_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

const resolveConfigPath = async (configPathValue: string): Promise<string> => {
  const normalized = configPathValue.trim()
  if (!normalized) {
    throw new Error('Config path is required.')
  }

  const candidate = path.resolve(PROJECT_ROOT, normalized)
  const relativeToConfigs = path.relative(CONFIGS_DIR, candidate)

  if (
    relativeToConfigs.startsWith('..') ||
    path.isAbsolute(relativeToConfigs) ||
    !candidate.startsWith(CONFIGS_DIR)
  ) {
    throw new Error('Config path must live under the repo configs directory.')
  }

  if (!/\.(yml|yaml)$/i.test(candidate) || !path.basename(candidate).startsWith('config_')) {
    throw new Error('Unknown config path.')
  }

  if (!(await fileExists(candidate))) {
    throw new Error('Config file does not exist.')
  }

  const content = await fs.readFile(candidate, 'utf8')
  if (!content.includes('front_end:')) {
    throw new Error('That config cannot be applied to the local web stack because it does not define front_end.')
  }

  return path.relative(PROJECT_ROOT, candidate)
}

const buildGeneratedConfigPath = (configPath: string): string => {
  const normalized = configPath.replace(/\\/g, '/')
  if (normalized.startsWith('configs/generated/') && path.basename(normalized).startsWith('config_runtime_')) {
    return normalized
  }

  const baseName = path.basename(configPath).replace(/\.(yml|yaml)$/i, '')
  const safeBaseName = baseName.replace(/[^a-zA-Z0-9_-]/g, '_')
  return path.join('configs', 'generated', `config_runtime_${safeBaseName}.yml`)
}

const toStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []

const getFunctionsRecord = (config: Record<string, unknown>): Record<string, unknown> | null => {
  const functions = config.functions
  return isRecord(functions) ? functions : null
}

const extractResearchOptions = (
  config: Record<string, unknown>,
  configPath: string | null,
  localStackRunning: boolean
): ResearchOptionsPayload => {
  const functions = getFunctionsRecord(config)
  if (!functions || !isRecord(functions.knowledge_search)) {
    return {
      supported: false,
      local_stack_running: localStackRunning,
      can_edit: false,
      requires_reload: true,
      config_path: configPath,
      generated_config_path: configPath ? buildGeneratedConfigPath(configPath) : null,
      knowledge_layer_enabled: false,
      generate_summary: false,
      top_k: 5,
      min_total_sources_retrieved: 0,
      min_total_cited_sources: 0,
      notes: ['The active config does not define a knowledge_search function, so these options are unavailable.'],
    }
  }

  const knowledgeSearch = functions.knowledge_search as Record<string, unknown>
  const deepResearchAgent = isRecord(functions.deep_research_agent)
    ? (functions.deep_research_agent as Record<string, unknown>)
    : null
  const relevantConsumers = KNOWLEDGE_TOOL_CONSUMERS.filter((fnName) => {
    const fnConfig = functions[fnName]
    return isRecord(fnConfig) && Array.isArray(fnConfig.tools)
  })

  const knowledgeLayerEnabled =
    relevantConsumers.length > 0 &&
    relevantConsumers.every((fnName) => toStringArray((functions[fnName] as Record<string, unknown>).tools).includes('knowledge_search'))

  const rawTopK = Number(knowledgeSearch.top_k ?? 5)
  const topK = Number.isFinite(rawTopK) && rawTopK > 0 ? Math.trunc(rawTopK) : 5
  const rawMinTotalSourcesRetrieved = Number(deepResearchAgent?.min_total_sources_retrieved ?? 0)
  const minTotalSourcesRetrieved =
    Number.isFinite(rawMinTotalSourcesRetrieved) && rawMinTotalSourcesRetrieved >= 0
      ? Math.trunc(rawMinTotalSourcesRetrieved)
      : 0
  const rawMinTotalCitedSources = Number(deepResearchAgent?.min_total_cited_sources ?? 0)
  const minTotalCitedSources =
    Number.isFinite(rawMinTotalCitedSources) && rawMinTotalCitedSources >= 0
      ? Math.trunc(rawMinTotalCitedSources)
      : 0

  return {
    supported: true,
    local_stack_running: localStackRunning,
    can_edit: localStackRunning,
    requires_reload: true,
    config_path: configPath,
    generated_config_path: configPath ? buildGeneratedConfigPath(configPath) : null,
    knowledge_layer_enabled: knowledgeLayerEnabled,
    generate_summary: knowledgeSearch.generate_summary === true,
    top_k: topK,
    min_total_sources_retrieved: minTotalSourcesRetrieved,
    min_total_cited_sources: minTotalCitedSources,
    notes: [
      'Top K applies to future retrieval calls after the backend reloads.',
      'Generate Summary affects newly uploaded or re-ingested files. Existing files keep their current summary state.',
      'Minimum Total Sources Retrieved counts distinct verified sources captured during a single research run. It does not increase tool budgets by itself.',
      'Minimum Total Cited Sources counts distinct verified sources that survive citation verification in the final report. Use 0 to disable either floor.',
    ],
  }
}

const ensureSummaryModelConfig = (config: Record<string, unknown>, knowledgeSearch: Record<string, unknown>): void => {
  const llms = isRecord(config.llms) ? config.llms : {}
  config.llms = llms

  if (typeof knowledgeSearch.summary_model !== 'string' || !knowledgeSearch.summary_model.trim()) {
    knowledgeSearch.summary_model = 'summary_llm'
  }

  if (!isRecord(llms.summary_llm)) {
    llms.summary_llm = {
      _type: 'nim',
      model_name: 'nvidia/nemotron-mini-4b-instruct',
      base_url: 'https://integrate.api.nvidia.com/v1',
      api_key: '${NVIDIA_API_KEY}',
      temperature: 0.3,
      max_tokens: 100,
    }
  }
}

const applyKnowledgeLayerToggle = (functions: Record<string, unknown>, enabled: boolean): void => {
  for (const fnName of KNOWLEDGE_TOOL_CONSUMERS) {
    const fnConfig = functions[fnName]
    if (!isRecord(fnConfig)) {
      continue
    }

    const existingTools = toStringArray(fnConfig.tools)
    if (existingTools.length === 0 && !Array.isArray(fnConfig.tools)) {
      continue
    }

    const nextTools = enabled
      ? existingTools.includes('knowledge_search')
        ? existingTools
        : [...existingTools, 'knowledge_search']
      : existingTools.filter((tool) => tool !== 'knowledge_search')

    fnConfig.tools = nextTools
  }
}

const applyResearchOptions = (
  config: Record<string, unknown>,
  request: Required<ApplyResearchOptionsRequest>
): Record<string, unknown> => {
  const functions = getFunctionsRecord(config)
  if (!functions || !isRecord(functions.knowledge_search)) {
    throw new Error('The active config does not define functions.knowledge_search.')
  }
  if (!isRecord(functions.deep_research_agent)) {
    throw new Error('The active config does not define functions.deep_research_agent.')
  }

  const knowledgeSearch = functions.knowledge_search as Record<string, unknown>
  const deepResearchAgent = functions.deep_research_agent as Record<string, unknown>
  knowledgeSearch.top_k = request.top_k
  knowledgeSearch.generate_summary = request.generate_summary
  deepResearchAgent.min_total_sources_retrieved = request.min_total_sources_retrieved
  deepResearchAgent.min_total_cited_sources = request.min_total_cited_sources

  if (request.generate_summary) {
    ensureSummaryModelConfig(config, knowledgeSearch)
  }

  applyKnowledgeLayerToggle(functions, request.knowledge_layer_enabled)
  return config
}

const scheduleBackendReload = async (
  state: LocalStackState,
  nextConfigPath: string,
  message: string
): Promise<{
  operationId: string
  backendUrl: string
  frontendUrl: string
}> => {
  const operationId = randomUUID()
  const backendPort = state.BACKEND_PORT ?? '8000'
  const frontendPort = state.FRONTEND_PORT ?? '3005'

  await writeReloadStatus(
    statusFromState(state, {
      operation_id: operationId,
      state: 'scheduled',
      message,
      config_path: nextConfigPath,
      previous_config_path: state.CONFIG_FILE ?? null,
    })
  )

  const child = spawn(
    '/bin/bash',
    [
      RESTART_SCRIPT,
      '--config_file',
      nextConfigPath,
      '--backend_port',
      backendPort,
      '--operation_id',
      operationId,
    ],
    {
      cwd: PROJECT_ROOT,
      detached: true,
      stdio: 'ignore',
    }
  )
  child.unref()

  return {
    operationId,
    backendUrl: `http://localhost:${backendPort}`,
    frontendUrl: `http://localhost:${frontendPort}`,
  }
}

export async function GET(): Promise<Response> {
  const state = await readLocalStackState()
  if (!state) {
    return NextResponse.json({
      supported: false,
      local_stack_running: false,
      can_edit: false,
      requires_reload: true,
      config_path: null,
      generated_config_path: null,
      knowledge_layer_enabled: false,
      generate_summary: false,
      top_k: 5,
      min_total_sources_retrieved: 0,
      min_total_cited_sources: 0,
      notes: ['Local config option editing is only available when AI-Q is running via ./scripts/start_local_stack.sh.'],
    } satisfies ResearchOptionsPayload)
  }

  try {
    const configPath = await resolveConfigPath(state.CONFIG_FILE ?? '')
    const absolutePath = path.join(PROJECT_ROOT, configPath)
    const content = await fs.readFile(absolutePath, 'utf8')
    const parsed = parse(content)

    if (!isRecord(parsed)) {
      throw new Error('The active config file could not be parsed as an object.')
    }

    return NextResponse.json(extractResearchOptions(parsed, configPath, true))
  } catch (error) {
    return NextResponse.json({
      supported: false,
      local_stack_running: true,
      can_edit: false,
      requires_reload: true,
      config_path: state.CONFIG_FILE ?? null,
      generated_config_path: state.CONFIG_FILE ? buildGeneratedConfigPath(state.CONFIG_FILE) : null,
      knowledge_layer_enabled: false,
      generate_summary: false,
      top_k: 5,
      min_total_sources_retrieved: 0,
      min_total_cited_sources: 0,
      notes: [error instanceof Error ? error.message : 'The active config could not be read.'],
    } satisfies ResearchOptionsPayload)
  }
}

export async function PATCH(req: NextRequest): Promise<Response> {
  const state = await readLocalStackState()
  if (!state) {
    return NextResponse.json(
      {
        error: {
          code: 'LOCAL_STACK_REQUIRED',
          message: 'Local research option editing is only available when AI-Q is running via ./scripts/start_local_stack.sh.',
        },
      },
      { status: 409 }
    )
  }

  const currentStatus = await readReloadStatus()
  if (['scheduled', 'validating', 'stopping', 'starting', 'rolling_back'].includes(currentStatus.state)) {
    return NextResponse.json(
      {
        error: {
          code: 'RELOAD_IN_PROGRESS',
          message: 'Another backend reload is already in progress. Wait for it to finish before applying new research options.',
        },
      },
      { status: 409 }
    )
  }

  let requestBody: Required<ApplyResearchOptionsRequest>
  try {
    const body = (await req.json()) as ApplyResearchOptionsRequest
    const topK = Number(body.top_k)
    if (!Number.isInteger(topK) || topK < 1 || topK > 50) {
      throw new Error('Top K must be a whole number between 1 and 50.')
    }
    const minTotalSourcesRetrieved = Number(body.min_total_sources_retrieved ?? 0)
    if (!Number.isInteger(minTotalSourcesRetrieved) || minTotalSourcesRetrieved < 0 || minTotalSourcesRetrieved > 5000) {
      throw new Error('Minimum Total Sources Retrieved must be a whole number between 0 and 5000.')
    }
    const minTotalCitedSources = Number(body.min_total_cited_sources ?? 0)
    if (!Number.isInteger(minTotalCitedSources) || minTotalCitedSources < 0 || minTotalCitedSources > 5000) {
      throw new Error('Minimum Total Cited Sources must be a whole number between 0 and 5000.')
    }
    if (minTotalSourcesRetrieved > 0 && minTotalCitedSources > minTotalSourcesRetrieved) {
      throw new Error('Minimum Total Cited Sources cannot exceed Minimum Total Sources Retrieved.')
    }

    requestBody = {
      knowledge_layer_enabled: body.knowledge_layer_enabled === true,
      generate_summary: body.generate_summary === true,
      top_k: topK,
      min_total_sources_retrieved: minTotalSourcesRetrieved,
      min_total_cited_sources: minTotalCitedSources,
    }
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: 'INVALID_OPTIONS',
          message: error instanceof Error ? error.message : 'Invalid research options payload.',
        },
      },
      { status: 400 }
    )
  }

  try {
    const currentConfigPath = await resolveConfigPath(state.CONFIG_FILE ?? '')
    const currentAbsolutePath = path.join(PROJECT_ROOT, currentConfigPath)
    const content = await fs.readFile(currentAbsolutePath, 'utf8')
    const parsed = parse(content)

    if (!isRecord(parsed)) {
      throw new Error('The active config file could not be parsed as an object.')
    }

    const currentOptions = extractResearchOptions(parsed, currentConfigPath, true)
    if (!currentOptions.supported) {
      throw new Error(currentOptions.notes[0] ?? 'The active config does not support knowledge-search options.')
    }

    const noChanges =
      currentOptions.knowledge_layer_enabled === requestBody.knowledge_layer_enabled &&
      currentOptions.generate_summary === requestBody.generate_summary &&
      currentOptions.top_k === requestBody.top_k &&
      currentOptions.min_total_sources_retrieved === requestBody.min_total_sources_retrieved &&
      currentOptions.min_total_cited_sources === requestBody.min_total_cited_sources

    if (noChanges) {
      return NextResponse.json({
        accepted: true,
        message: 'These research options are already active.',
        config_path: currentConfigPath,
        backend_url: `http://localhost:${state.BACKEND_PORT ?? '8000'}`,
        frontend_url: `http://localhost:${state.FRONTEND_PORT ?? '3005'}`,
        operation_id: null,
        options: currentOptions,
      })
    }

    const updatedConfig = applyResearchOptions(parsed, requestBody)
    const generatedConfigPath = buildGeneratedConfigPath(currentConfigPath)
    const generatedAbsolutePath = path.join(PROJECT_ROOT, generatedConfigPath)

    await fs.mkdir(path.dirname(generatedAbsolutePath), { recursive: true })
    await fs.writeFile(generatedAbsolutePath, stringify(updatedConfig), 'utf8')

    const { operationId, backendUrl, frontendUrl } = await scheduleBackendReload(
      state,
      generatedConfigPath,
      'Research option changes scheduled. The local backend will reload shortly.'
    )

    const nextOptions = extractResearchOptions(updatedConfig, generatedConfigPath, true)

    return NextResponse.json({
      accepted: true,
      message: 'Research option changes scheduled. The frontend will track backend restart progress automatically.',
      config_path: generatedConfigPath,
      backend_url: backendUrl,
      frontend_url: frontendUrl,
      operation_id: operationId,
      options: nextOptions,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: 'OPTIONS_APPLY_FAILED',
          message: error instanceof Error ? error.message : 'Failed to apply research options.',
        },
      },
      { status: 400 }
    )
  }
}
