// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'

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

interface TavilyApiKeyPayload {
  local_stack_running: boolean
  can_edit: boolean
  requires_reload: boolean
  env_path: string | null
  configured: boolean
  key_hint: string | null
  notes: string[]
}

interface UpdateTavilyApiKeyRequest {
  api_key?: string
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
const RESTART_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'restart_local_backend.sh')
const DEPLOY_ENV_FILE = path.join(PROJECT_ROOT, 'deploy', '.env')

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

const stripWrappingQuotes = (value: string): string => {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }

  return value
}

const parseEnvFile = (content: string): Record<string, string> => {
  const values: Record<string, string> = {}

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }

    const normalized = line.startsWith('export ') ? line.slice('export '.length).trim() : line
    const separatorIndex = normalized.indexOf('=')
    if (separatorIndex <= 0) {
      continue
    }

    const key = normalized.slice(0, separatorIndex).trim()
    const value = stripWrappingQuotes(normalized.slice(separatorIndex + 1).trim())
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

const serializeEnvValue = (value: string): string => {
  if (/^[A-Za-z0-9._:@/+,-]+$/.test(value)) {
    return value
  }

  return `'${value.replace(/'/g, `'\\''`)}'`
}

const trimTrailingBlankLines = (lines: string[]): string[] => {
  const trimmed = [...lines]
  while (trimmed.length > 0 && trimmed[trimmed.length - 1].trim() === '') {
    trimmed.pop()
  }
  return trimmed
}

const upsertEnvValue = (content: string, key: string, value: string): string => {
  const lines = content.split(/\r?\n/)
  const nextLines: string[] = []
  const keyPattern = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`)
  let replaced = false

  for (const line of lines) {
    if (!keyPattern.test(line)) {
      nextLines.push(line)
      continue
    }

    if (!replaced) {
      nextLines.push(`${key}=${serializeEnvValue(value)}`)
      replaced = true
    }
  }

  const normalizedLines = trimTrailingBlankLines(nextLines)
  if (!replaced && normalizedLines.length > 0) {
    normalizedLines.push('')
  }
  if (!replaced) {
    normalizedLines.push(`${key}=${serializeEnvValue(value)}`)
  }

  return `${normalizedLines.join('\n')}\n`
}

const readSavedTavilyApiKey = async (): Promise<string | null> => {
  if (!(await fileExists(DEPLOY_ENV_FILE))) {
    return null
  }

  const content = await fs.readFile(DEPLOY_ENV_FILE, 'utf8')
  return parseEnvFile(content).TAVILY_API_KEY ?? null
}

const maskApiKey = (value: string | null): string | null => {
  if (!value) {
    return null
  }

  if (value.length <= 4) {
    return 'Configured'
  }

  return `••••${value.slice(-4)}`
}

const buildStatusPayload = (
  state: LocalStackState | null,
  apiKey: string | null
): TavilyApiKeyPayload => ({
  local_stack_running: Boolean(state),
  can_edit: Boolean(state) && existsSync(RESTART_SCRIPT),
  requires_reload: true,
  env_path: 'deploy/.env',
  configured: Boolean(apiKey),
  key_hint: maskApiKey(apiKey),
  notes: [
    apiKey
      ? 'A Tavily API key is saved in deploy/.env for the local stack.'
      : 'No Tavily API key is saved in deploy/.env yet.',
    'Saving a new Tavily key reloads the local backend because the Tavily search tool is registered when the backend starts.',
  ],
})

const scheduleBackendReload = async (
  state: LocalStackState,
  message: string
): Promise<{
  operationId: string
  configPath: string
  backendUrl: string
  frontendUrl: string
}> => {
  const configPath = (state.CONFIG_FILE ?? '').trim()
  if (!configPath) {
    throw new Error('The local stack state does not include a config file to restart.')
  }
  if (!existsSync(RESTART_SCRIPT)) {
    throw new Error('The local backend restart helper is not available.')
  }

  const operationId = randomUUID()
  const backendPort = state.BACKEND_PORT ?? '8000'
  const frontendPort = state.FRONTEND_PORT ?? '3005'

  await writeReloadStatus(
    statusFromState(state, {
      operation_id: operationId,
      state: 'scheduled',
      message,
      config_path: configPath,
      previous_config_path: configPath,
    })
  )

  const child = spawn(
    '/bin/bash',
    [
      RESTART_SCRIPT,
      '--config_file',
      configPath,
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
    configPath,
    backendUrl: `http://localhost:${backendPort}`,
    frontendUrl: `http://localhost:${frontendPort}`,
  }
}

export async function GET(): Promise<Response> {
  const state = await readLocalStackState()
  if (!state) {
    return NextResponse.json({
      ...buildStatusPayload(null, null),
      notes: ['Local Tavily key editing is only available when AI-Q is running via ./scripts/start_local_stack.sh.'],
    } satisfies TavilyApiKeyPayload)
  }

  try {
    const apiKey = await readSavedTavilyApiKey()
    return NextResponse.json(buildStatusPayload(state, apiKey))
  } catch (error) {
    return NextResponse.json({
      ...buildStatusPayload(state, null),
      can_edit: false,
      notes: [error instanceof Error ? error.message : 'The local Tavily API key could not be read.'],
    } satisfies TavilyApiKeyPayload)
  }
}

export async function PATCH(req: NextRequest): Promise<Response> {
  const state = await readLocalStackState()
  if (!state) {
    return NextResponse.json(
      {
        error: {
          code: 'LOCAL_STACK_REQUIRED',
          message: 'Local Tavily key editing is only available when AI-Q is running via ./scripts/start_local_stack.sh.',
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
          message: 'Another backend reload is already in progress. Wait for it to finish before updating the Tavily API key.',
        },
      },
      { status: 409 }
    )
  }

  let nextApiKey: string
  try {
    const body = (await req.json()) as UpdateTavilyApiKeyRequest
    nextApiKey = body.api_key?.trim() ?? ''
    if (!nextApiKey) {
      throw new Error('A Tavily API key is required.')
    }
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: 'INVALID_API_KEY',
          message: error instanceof Error ? error.message : 'Invalid Tavily API key payload.',
        },
      },
      { status: 400 }
    )
  }

  try {
    const currentApiKey = await readSavedTavilyApiKey()
    const nextStatus = buildStatusPayload(state, nextApiKey)

    if (currentApiKey === nextApiKey) {
      return NextResponse.json({
        accepted: true,
        message: 'That Tavily API key is already saved for the local stack.',
        config_path: state.CONFIG_FILE ?? '',
        backend_url: `http://localhost:${state.BACKEND_PORT ?? '8000'}`,
        frontend_url: `http://localhost:${state.FRONTEND_PORT ?? '3005'}`,
        operation_id: null,
        status: nextStatus,
      })
    }

    const currentEnvContent = (await fileExists(DEPLOY_ENV_FILE))
      ? await fs.readFile(DEPLOY_ENV_FILE, 'utf8')
      : ''
    const nextEnvContent = upsertEnvValue(currentEnvContent, 'TAVILY_API_KEY', nextApiKey)

    await fs.mkdir(path.dirname(DEPLOY_ENV_FILE), { recursive: true })
    await fs.writeFile(DEPLOY_ENV_FILE, nextEnvContent, 'utf8')

    const { operationId, configPath, backendUrl, frontendUrl } = await scheduleBackendReload(
      state,
      'Tavily API key updated. The local backend will reload shortly.'
    )

    return NextResponse.json({
      accepted: true,
      message: 'Tavily API key saved. The frontend will track backend restart progress automatically.',
      config_path: configPath,
      backend_url: backendUrl,
      frontend_url: frontendUrl,
      operation_id: operationId,
      status: nextStatus,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: 'TAVILY_KEY_UPDATE_FAILED',
          message: error instanceof Error ? error.message : 'Failed to update the Tavily API key.',
        },
      },
      { status: 400 }
    )
  }
}
