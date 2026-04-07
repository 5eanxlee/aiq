// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { render, screen } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { vi, describe, test, expect, beforeEach } from 'vitest'
import { SettingsPanel } from './SettingsPanel'

const mockGetProviderStatus = vi.fn().mockResolvedValue({
  generated_at: '2026-04-07T01:00:00Z',
  can_run_research: true,
  missing_requirements: [],
  runtime_window_minutes: 360,
  providers: [],
  workers: [],
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

// Mock the layout store
const mockCloseRightPanel = vi.fn()
const mockOpenRightPanel = vi.fn()
const mockSetTheme = vi.fn()

vi.mock('../store', () => ({
  useLayoutStore: vi.fn(() => ({
    rightPanel: 'settings',
    closeRightPanel: mockCloseRightPanel,
    openRightPanel: mockOpenRightPanel,
    theme: 'system',
    setTheme: mockSetTheme,
  })),
}))

import { useLayoutStore } from '../store'

describe('SettingsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetProviderStatus.mockResolvedValue({
      generated_at: '2026-04-07T01:00:00Z',
      can_run_research: true,
      missing_requirements: [],
      runtime_window_minutes: 360,
      providers: [],
      workers: [],
    })
    // Reset mock to default open state
    vi.mocked(useLayoutStore).mockReturnValue({
      rightPanel: 'settings',
      closeRightPanel: mockCloseRightPanel,
      openRightPanel: mockOpenRightPanel,
      theme: 'system',
      setTheme: mockSetTheme,
    })
  })

  test('renders panel heading when open', () => {
    render(<SettingsPanel />)

    expect(screen.getByText('Settings')).toBeInTheDocument()
  })

  test('renders theme options section with Select trigger', () => {
    render(<SettingsPanel />)

    expect(screen.getByText('UI Theme Options')).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  test('select trigger reflects current theme', () => {
    vi.mocked(useLayoutStore).mockReturnValue({
      rightPanel: 'settings',
      closeRightPanel: mockCloseRightPanel,
      openRightPanel: mockOpenRightPanel,
      theme: 'dark',
      setTheme: mockSetTheme,
    })

    render(<SettingsPanel />)

    const trigger = screen.getByRole('combobox')
    expect(trigger).toHaveTextContent('Dark')
  })

  test('calls setTheme when a theme option is selected', async () => {
    const user = userEvent.setup()

    render(<SettingsPanel />)

    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: /dark/i }))

    expect(mockSetTheme).toHaveBeenCalledWith('dark')
  })

  test('does not render when panel is closed', () => {
    vi.mocked(useLayoutStore).mockReturnValue({
      rightPanel: null,
      closeRightPanel: mockCloseRightPanel,
      openRightPanel: mockOpenRightPanel,
      theme: 'system',
      setTheme: mockSetTheme,
    })

    render(<SettingsPanel />)

    // Panel should not be visible (SidePanel handles this)
    // The heading won't be rendered in closed state
    // This tests the isOpen logic
    expect(screen.queryByText('Settings')).not.toBeInTheDocument()
  })

  test('renders footer text', () => {
    render(<SettingsPanel />)

    expect(screen.getByText(/settings are saved automatically/i)).toBeInTheDocument()
  })

  test('renders limited provider status with warning label', async () => {
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
    })

    render(<SettingsPanel />)

    expect(await screen.findByText('Limited')).toBeInTheDocument()
    expect(screen.getByText('Semantic Scholar')).toBeInTheDocument()
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
    })

    render(<SettingsPanel />)

    expect(await screen.findByText('Worker Models')).toBeInTheDocument()
    expect(screen.getByTestId('worker-status-deep_research_agent')).toBeInTheDocument()
    expect(screen.getByText('Observed At Runtime')).toBeInTheDocument()
    expect(screen.getAllByText('openai/gpt-oss-120b').length).toBeGreaterThan(0)
  })
})
