// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { getJobStatus } from './deep-research-client'

describe('deep-research-client', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('retries getJobStatus once after a transient 500', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: 'PROXY_ERROR', message: 'fetch failed' } }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            job_id: 'job-1',
            status: 'running',
            error: null,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      )

    vi.stubGlobal('fetch', mockFetch)

    const result = await getJobStatus('job-1')

    expect(result).toEqual({
      job_id: 'job-1',
      status: 'running',
      error: null,
    })
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  test('does not retry getJobStatus after a 404', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'missing job' } }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    vi.stubGlobal('fetch', mockFetch)

    await expect(getJobStatus('job-missing')).rejects.toThrow('Failed to get job status: 404')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})
