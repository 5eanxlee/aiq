// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { render, screen } from '@/test-utils'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { ProvidersPanel } from './ProvidersPanel'

const mockGetProviderStatus = vi.fn().mockResolvedValue({
  generated_at: '2026-04-07T01:00:00Z',
  can_run_research: true,
  missing_requirements: [],
  runtime_window_minutes: 360,
  providers: [],
  workers: [],
  config_presets: [],
  config_runtime: null,
})

vi.mock('@/adapters/auth', () => ({
  useAuth: vi.fn(() => ({
    idToken: null,
    authRequired: false,
    error: null,
  })),
}))

vi.mock('@/adapters/api', () => ({
  createProviderStatusClient: vi.fn(() => ({
    getProviderStatus: mockGetProviderStatus,
  })),
}))

const mockCloseRightPanel = vi.fn()
const mockOpenRightPanel = vi.fn()

vi.mock('../store', () => ({
  useLayoutStore: vi.fn(() => ({
    rightPanel: 'providers',
    closeRightPanel: mockCloseRightPanel,
    openRightPanel: mockOpenRightPanel,
  })),
}))

describe('ProvidersPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('renders provider readiness cards', async () => {
    mockGetProviderStatus.mockResolvedValue({
      generated_at: '2026-04-07T01:00:00Z',
      can_run_research: true,
      missing_requirements: [],
      runtime_window_minutes: 360,
      providers: [
        {
          id: 'semantic_scholar',
          name: 'Semantic Scholar',
          kind: 'search',
          active: true,
          configured: true,
          connected: null,
          status: 'limited',
          detail:
            'Semantic Scholar is using unauthenticated access. The dashboard skips the live probe to avoid exhausting public rate limits.',
          features: ['paper_search'],
          models: [],
          endpoints: [],
          runtime_calls: [],
          quota: {
            supported: false,
            message: 'Semantic Scholar does not expose remaining quota or credits via API.',
          },
        },
      ],
      workers: [],
      config_presets: [],
      config_runtime: null,
    })

    render(<ProvidersPanel />)

    expect(await screen.findByText('Research Providers')).toBeInTheDocument()
    expect(screen.getByTestId('provider-status-semantic_scholar')).toBeInTheDocument()
    expect(screen.getByText('Semantic Scholar')).toBeInTheDocument()
    expect(screen.getByText('Limited')).toBeInTheDocument()
  })

  test('renders worker model runtime observations', async () => {
    mockGetProviderStatus.mockResolvedValue({
      generated_at: '2026-04-07T01:00:00Z',
      can_run_research: true,
      missing_requirements: [],
      runtime_window_minutes: 360,
      providers: [],
      workers: [
        {
          id: 'deep_research_agent',
          name: 'Deep Research',
          last_runtime_at: '2026-04-07T01:00:00Z',
          llms: [
            {
              role: 'Orchestrator',
              llm_ref: 'gpt_oss_llm',
              provider_id: 'nvidia',
              model_name: 'openai/gpt-oss-120b',
              endpoint: 'https://integrate.api.nvidia.com/v1',
              temperature: 1,
              top_p: 1,
              max_tokens: 256000,
            },
          ],
          runtime_calls: [
            {
              worker: 'deep_research_agent',
              model_name: 'openai/gpt-oss-120b',
              provider_id: 'nvidia',
              endpoint: 'https://integrate.api.nvidia.com/v1',
              temperature: 1,
              top_p: 1,
              max_tokens: 256000,
              first_seen_at: '2026-04-07T00:55:00Z',
              last_seen_at: '2026-04-07T01:00:00Z',
              call_count: 3,
              prompt_tokens: 300,
              completion_tokens: 150,
              total_tokens: 450,
            },
          ],
        },
      ],
      config_presets: [],
      config_runtime: null,
    })

    render(<ProvidersPanel />)

    expect(await screen.findByText('Worker Models')).toBeInTheDocument()
    expect(screen.getByTestId('worker-status-deep_research_agent')).toBeInTheDocument()
    expect(screen.getByText('Observed At Runtime')).toBeInTheDocument()
    expect(screen.getAllByText('openai/gpt-oss-120b').length).toBeGreaterThan(0)
  })
})
