// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
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

export async function GET(): Promise<Response> {
  const status = await readReloadStatus()
  return NextResponse.json(status)
}

export async function POST(req: NextRequest): Promise<Response> {
  const state = await readLocalStackState()
  if (!state) {
    return NextResponse.json(
      {
        error: {
          code: 'LOCAL_STACK_REQUIRED',
          message: 'Local config switching is only available when AI-Q is running via ./scripts/start_local_stack.sh.',
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
          message: 'Another backend reload is already in progress. Wait for it to finish before applying a new config.',
        },
      },
      { status: 409 }
    )
  }

  let configPath: string
  try {
    const body = (await req.json()) as { config_path?: string }
    configPath = await resolveConfigPath(body?.config_path ?? '')
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: 'INVALID_CONFIG',
          message: error instanceof Error ? error.message : 'Invalid config path.',
        },
      },
      { status: 400 }
    )
  }

  if (state.CONFIG_FILE === configPath) {
    return NextResponse.json({
      accepted: true,
      message: 'That config is already active for the local stack.',
      config_path: configPath,
      backend_url: `http://localhost:${state.BACKEND_PORT ?? '8000'}`,
      frontend_url: `http://localhost:${state.FRONTEND_PORT ?? '3005'}`,
      operation_id: null,
    })
  }

  const operationId = randomUUID()
  const backendPort = state.BACKEND_PORT ?? '8000'
  const frontendPort = state.FRONTEND_PORT ?? '3005'

  await writeReloadStatus(
    statusFromState(state, {
      operation_id: operationId,
      state: 'scheduled',
      message: 'Backend reload scheduled. Validation will run before the current backend is stopped.',
      config_path: configPath,
      previous_config_path: state.CONFIG_FILE ?? null,
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

  return NextResponse.json({
    accepted: true,
    message: 'Config switch scheduled. The frontend will track backend validation and restart progress automatically.',
    config_path: configPath,
    backend_url: `http://localhost:${backendPort}`,
    frontend_url: `http://localhost:${frontendPort}`,
    operation_id: operationId,
  })
}
