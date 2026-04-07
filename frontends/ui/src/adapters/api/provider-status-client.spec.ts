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
})
