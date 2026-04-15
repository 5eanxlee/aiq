// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { createProviderStatusClient } from './provider-status-client'

vi.mock('./config', () => ({
  apiConfig: {
    baseUrl: '',
  },
}))

describe('createProviderStatusClient', () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
    global.fetch = mockFetch as typeof fetch
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  test('fetches provider status successfully', async () => {
    const payload = {
      generated_at: '2026-04-07T01:00:00Z',
      can_run_research: true,
      missing_requirements: [],
      runtime_window_minutes: 360,
      providers: [],
      workers: [],
      config_presets: [],
      config_runtime: null,
    }

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(payload),
    })

    const client = createProviderStatusClient()
    const result = await client.getProviderStatus()

    expect(result).toEqual(payload)
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/providers/status', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: undefined,
    })
  })

  test('includes auth token in headers when provided', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          generated_at: '2026-04-07T01:00:00Z',
          can_run_research: true,
          missing_requirements: [],
          runtime_window_minutes: 360,
          providers: [],
          workers: [],
          config_presets: [],
          config_runtime: null,
        }),
    })

    const client = createProviderStatusClient({ authToken: 'test-token' })
    await client.getProviderStatus()

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        },
      })
    )
  })

  test('returns a helpful message when the backend endpoint is missing', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: () => Promise.resolve({ detail: 'Not Found' }),
    })

    const client = createProviderStatusClient()

    await expect(client.getProviderStatus()).rejects.toThrow(
      'Provider dashboard is unavailable on the running backend. Restart or rebuild the backend so it serves /v1/providers/status.'
    )
  })

  test('applies a config preset successfully', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          accepted: true,
          message: 'Preset switch scheduled.',
          config_path: 'configs/config_preset_max_quality.yml',
          backend_url: 'http://localhost:8001',
          frontend_url: 'http://localhost:3005',
          operation_id: 'reload-op-1',
        }),
    })

    const client = createProviderStatusClient()
    const result = await client.applyConfigPreset('configs/config_preset_max_quality.yml')

    expect(result.accepted).toBe(true)
    expect(mockFetch).toHaveBeenCalledWith('/api/local-stack/config-reload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config_path: 'configs/config_preset_max_quality.yml' }),
      signal: undefined,
    })
  })

  test('reads local config reload status successfully', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          operation_id: 'reload-op-1',
          state: 'starting',
          message: 'Starting backend.',
          config_path: 'configs/config_preset_max_quality.yml',
        }),
    })

    const client = createProviderStatusClient()
    const result = await client.getLocalConfigReloadStatus()

    expect(result.state).toBe('starting')
    expect(mockFetch).toHaveBeenCalledWith('/api/local-stack/config-reload', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: undefined,
    })
  })

  test('reads local research options successfully', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          supported: true,
          local_stack_running: true,
          can_edit: true,
          requires_reload: true,
          config_path: 'configs/config_preset_current_setup.yml',
          generated_config_path: 'configs/generated/config_runtime_config_preset_current_setup.yml',
          knowledge_layer_enabled: true,
          generate_summary: true,
          top_k: 9,
          min_total_sources_retrieved: 0,
          min_total_cited_sources: 0,
          notes: ['Top K applies after reload.'],
        }),
    })

    const client = createProviderStatusClient()
    const result = await client.getLocalResearchOptions()

    expect(result.top_k).toBe(9)
    expect(result.min_total_sources_retrieved).toBe(0)
    expect(mockFetch).toHaveBeenCalledWith('/api/local-stack/research-options', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: undefined,
    })
  })

  test('applies local research options successfully', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          accepted: true,
          message: 'Research option changes scheduled.',
          config_path: 'configs/generated/config_runtime_config_preset_current_setup.yml',
          backend_url: 'http://localhost:8000',
          frontend_url: 'http://localhost:3005',
          operation_id: 'reload-op-2',
        }),
    })

    const client = createProviderStatusClient()
    const result = await client.applyLocalResearchOptions({
      knowledge_layer_enabled: true,
      generate_summary: false,
      top_k: 7,
      min_total_sources_retrieved: 120,
      min_total_cited_sources: 12,
    })

    expect(result.accepted).toBe(true)
    expect(mockFetch).toHaveBeenCalledWith('/api/local-stack/research-options', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        knowledge_layer_enabled: true,
        generate_summary: false,
        top_k: 7,
        min_total_sources_retrieved: 120,
        min_total_cited_sources: 12,
      }),
      signal: undefined,
    })
  })

  test('reads local Tavily API key status successfully', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          local_stack_running: true,
          can_edit: true,
          requires_reload: true,
          env_path: 'deploy/.env',
          configured: true,
          key_hint: '••••abcd',
          notes: ['Saving a new Tavily key reloads the local backend.'],
        }),
    })

    const client = createProviderStatusClient()
    const result = await client.getLocalTavilyApiKeyStatus()

    expect(result.configured).toBe(true)
    expect(mockFetch).toHaveBeenCalledWith('/api/local-stack/tavily-api-key', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: undefined,
    })
  })

  test('updates the local Tavily API key successfully', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          accepted: true,
          message: 'Tavily API key saved.',
          config_path: 'configs/config_preset_current_setup.yml',
          backend_url: 'http://localhost:8000',
          frontend_url: 'http://localhost:3005',
          operation_id: 'reload-op-3',
          status: {
            local_stack_running: true,
            can_edit: true,
            requires_reload: true,
            env_path: 'deploy/.env',
            configured: true,
            key_hint: '••••abcd',
            notes: ['Saving a new Tavily key reloads the local backend.'],
          },
        }),
    })

    const client = createProviderStatusClient()
    const result = await client.updateLocalTavilyApiKey({ api_key: 'tvly-test-key' })

    expect(result.accepted).toBe(true)
    expect(mockFetch).toHaveBeenCalledWith('/api/local-stack/tavily-api-key', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: 'tvly-test-key' }),
      signal: undefined,
    })
  })
})
