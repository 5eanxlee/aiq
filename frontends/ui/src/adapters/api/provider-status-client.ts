// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Provider Status API Client
 *
 * Fetches provider readiness and quota details from the backend.
 */

import { apiConfig } from './config'

const getBaseUrl = (): string => {
  const isBrowser = typeof window !== 'undefined'
  return isBrowser ? '' : apiConfig.baseUrl
}

export interface ProviderQuotaFromAPI {
  supported: boolean
  has_credit?: boolean | null
  remaining?: number | null
  used?: number | null
  limit?: number | null
  unit?: string | null
  rate_limit?: number | null
  message?: string | null
}

export interface RuntimeModelObservationFromAPI {
  worker: string
  model_name: string
  provider_id?: string | null
  endpoint?: string | null
  temperature?: number | null
  top_p?: number | null
  max_tokens?: number | null
  first_seen_at: string
  last_seen_at: string
  call_count: number
  prompt_tokens?: number | null
  completion_tokens?: number | null
  total_tokens?: number | null
}

export interface WorkerLLMConfigFromAPI {
  role: string
  llm_ref: string
  provider_id?: string | null
  model_name?: string | null
  endpoint?: string | null
  temperature?: number | null
  top_p?: number | null
  max_tokens?: number | null
}

export interface WorkerStatusFromAPI {
  id: string
  name: string
  llms: WorkerLLMConfigFromAPI[]
  runtime_calls: RuntimeModelObservationFromAPI[]
  last_runtime_at?: string | null
}

export interface ProviderStatusFromAPI {
  id: string
  name: string
  kind: 'llm' | 'search' | string
  active: boolean
  configured: boolean
  connected?: boolean | null
  status: 'ready' | 'inactive' | 'missing_config' | 'error' | 'limited' | string
  detail?: string | null
  features: string[]
  models: string[]
  endpoints: string[]
  runtime_calls: RuntimeModelObservationFromAPI[]
  quota: ProviderQuotaFromAPI
}

export interface ProviderDashboardFromAPI {
  generated_at: string
  can_run_research: boolean
  missing_requirements: string[]
  runtime_window_minutes: number
  providers: ProviderStatusFromAPI[]
  workers: WorkerStatusFromAPI[]
  config_presets: ConfigPresetFromAPI[]
  config_runtime?: ConfigRuntimeFromAPI | null
}

export interface ConfigPresetFromAPI {
  id: string
  name: string
  config_path: string
  description?: string | null
  kind?: 'preset' | 'repo_config' | string
  recommended: boolean
  current: boolean
}

export interface ConfigRuntimeFromAPI {
  current_config_path?: string | null
  current_config_name?: string | null
  current_preset_id?: string | null
  can_apply_presets: boolean
  apply_requires_restart: boolean
  local_stack_running: boolean
  backend_port?: number | null
  frontend_port?: number | null
  next_port?: number | null
}

export interface ApplyConfigPresetResponseFromAPI {
  accepted: boolean
  message: string
  config_path: string
  backend_url?: string | null
  frontend_url?: string | null
  operation_id?: string | null
}

export interface LocalResearchOptionsFromAPI {
  supported: boolean
  local_stack_running: boolean
  can_edit: boolean
  requires_reload: boolean
  config_path?: string | null
  generated_config_path?: string | null
  knowledge_layer_enabled: boolean
  generate_summary: boolean
  top_k: number
  notes: string[]
}

export interface ApplyLocalResearchOptionsRequestFromAPI {
  knowledge_layer_enabled: boolean
  generate_summary: boolean
  top_k: number
}

export interface ApplyLocalResearchOptionsResponseFromAPI extends ApplyConfigPresetResponseFromAPI {
  options?: LocalResearchOptionsFromAPI
}

export interface LocalConfigReloadStatusFromAPI {
  operation_id?: string | null
  state:
    | 'idle'
    | 'scheduled'
    | 'validating'
    | 'stopping'
    | 'starting'
    | 'rolling_back'
    | 'rolled_back'
    | 'ready'
    | 'failed'
    | string
  message: string
  error?: string | null
  config_path?: string | null
  previous_config_path?: string | null
  backend_url?: string | null
  frontend_url?: string | null
  log_path?: string | null
  rollback_attempted?: boolean
  rollback_succeeded?: boolean
  updated_at?: string | null
}

export interface ProviderStatusClientOptions {
  authToken?: string
}

async function handleApiError(response: Response, context: string): Promise<never> {
  const error = await response.json().catch(() => ({}))
  const errorMessage = error?.error?.message

  if (response.status === 404 && context === 'Failed to fetch provider status') {
    throw new Error(
      'Provider dashboard is unavailable on the running backend. Restart or rebuild the backend so it serves /v1/providers/status.'
    )
  }

  throw new Error(errorMessage || `${context}: ${response.statusText}`)
}

export const createProviderStatusClient = (options: ProviderStatusClientOptions = {}) => {
  const { authToken } = options

  const getHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`
    }
    return headers
  }

  return {
    async getProviderStatus(signal?: AbortSignal): Promise<ProviderDashboardFromAPI> {
      const baseUrl = getBaseUrl()
      const url = baseUrl ? `${baseUrl}/v1/providers/status` : '/api/v1/providers/status'
      const response = await fetch(url, {
        method: 'GET',
        headers: getHeaders(),
        signal,
      })

      if (!response.ok) {
        await handleApiError(response, 'Failed to fetch provider status')
      }

      return response.json()
    },

    async applyConfigPreset(configPath: string, signal?: AbortSignal): Promise<ApplyConfigPresetResponseFromAPI> {
      const url = '/api/local-stack/config-reload'
      const response = await fetch(url, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ config_path: configPath }),
        signal,
      })

      if (!response.ok) {
        await handleApiError(response, 'Failed to apply config preset')
      }

      return response.json()
    },

    async getLocalConfigReloadStatus(signal?: AbortSignal): Promise<LocalConfigReloadStatusFromAPI> {
      const response = await fetch('/api/local-stack/config-reload', {
        method: 'GET',
        headers: getHeaders(),
        signal,
      })

      if (!response.ok) {
        await handleApiError(response, 'Failed to fetch local config reload status')
      }

      return response.json()
    },

    async getLocalResearchOptions(signal?: AbortSignal): Promise<LocalResearchOptionsFromAPI> {
      const response = await fetch('/api/local-stack/research-options', {
        method: 'GET',
        headers: getHeaders(),
        signal,
      })

      if (!response.ok) {
        await handleApiError(response, 'Failed to fetch local research options')
      }

      return response.json()
    },

    async applyLocalResearchOptions(
      options: ApplyLocalResearchOptionsRequestFromAPI,
      signal?: AbortSignal
    ): Promise<ApplyLocalResearchOptionsResponseFromAPI> {
      const response = await fetch('/api/local-stack/research-options', {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify(options),
        signal,
      })

      if (!response.ok) {
        await handleApiError(response, 'Failed to apply local research options')
      }

      return response.json()
    },
  }
}

export type ProviderStatusClient = ReturnType<typeof createProviderStatusClient>
