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
  }
}

export type ProviderStatusClient = ReturnType<typeof createProviderStatusClient>
