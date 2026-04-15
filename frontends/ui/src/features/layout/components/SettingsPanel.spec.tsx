// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { render, screen } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { SettingsPanel } from './SettingsPanel'

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
const mockApplyConfigPreset = vi.fn()
const mockGetLocalResearchOptions = vi.fn()
const mockApplyLocalResearchOptions = vi.fn()
const mockGetLocalTavilyApiKeyStatus = vi.fn()
const mockUpdateLocalTavilyApiKey = vi.fn()
const mockGetLocalConfigReloadStatus = vi.fn().mockResolvedValue({
  operation_id: 'reload-op-1',
  state: 'ready',
  message: 'The backend is healthy and running the selected research config.',
})

vi.mock('@/adapters/auth', () => ({
  useAuth: vi.fn(() => ({
    idToken: null,
    authRequired: false,
    error: null,
  })),
}))

vi.mock('@/adapters/api', () => ({
  checkBackendHealth: vi.fn().mockResolvedValue(false),
  createProviderStatusClient: vi.fn(() => ({
    getProviderStatus: mockGetProviderStatus,
    applyConfigPreset: mockApplyConfigPreset,
    getLocalResearchOptions: mockGetLocalResearchOptions,
    applyLocalResearchOptions: mockApplyLocalResearchOptions,
    getLocalTavilyApiKeyStatus: mockGetLocalTavilyApiKeyStatus,
    updateLocalTavilyApiKey: mockUpdateLocalTavilyApiKey,
    getLocalConfigReloadStatus: mockGetLocalConfigReloadStatus,
  })),
}))

const mockCloseRightPanel = vi.fn()
const mockOpenRightPanel = vi.fn()

vi.mock('../store', () => ({
  useLayoutStore: vi.fn(() => ({
    rightPanel: 'settings',
    closeRightPanel: mockCloseRightPanel,
    openRightPanel: mockOpenRightPanel,
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
      config_presets: [],
      config_runtime: null,
    })
    mockApplyConfigPreset.mockReset()
    mockGetLocalResearchOptions.mockReset()
    mockGetLocalResearchOptions.mockResolvedValue({
      supported: true,
      local_stack_running: true,
      can_edit: true,
      requires_reload: true,
      config_path: 'configs/config_preset_current_setup.yml',
      generated_config_path: 'configs/generated/config_runtime_config_preset_current_setup.yml',
      knowledge_layer_enabled: false,
      generate_summary: false,
      top_k: 5,
      min_total_sources_retrieved: 0,
      min_total_cited_sources: 0,
      notes: [
        'Top K applies to future retrieval calls after the backend reloads.',
        'Generate Summary affects newly uploaded or re-ingested files. Existing files keep their current summary state.',
      ],
    })
    mockApplyLocalResearchOptions.mockReset()
    mockGetLocalTavilyApiKeyStatus.mockReset()
    mockGetLocalTavilyApiKeyStatus.mockResolvedValue({
      local_stack_running: true,
      can_edit: true,
      requires_reload: true,
      env_path: 'deploy/.env',
      configured: true,
      key_hint: '••••abcd',
      notes: ['Saving a new Tavily key reloads the local backend.'],
    })
    mockUpdateLocalTavilyApiKey.mockReset()
    mockGetLocalConfigReloadStatus.mockReset()
    mockGetLocalConfigReloadStatus.mockResolvedValue({
      operation_id: 'reload-op-1',
      state: 'ready',
      message: 'The backend is healthy and running the selected research config.',
    })
    vi.mocked(useLayoutStore).mockReturnValue({
      rightPanel: 'settings',
      closeRightPanel: mockCloseRightPanel,
      openRightPanel: mockOpenRightPanel,
    })
  })

  test('renders panel heading when open', async () => {
    render(<SettingsPanel />)

    expect(await screen.findByText('No web-enabled configurations were detected for this backend.')).toBeInTheDocument()
    expect(screen.getByText('Config')).toBeInTheDocument()
  })

  test('renders model and options tabs', async () => {
    render(<SettingsPanel />)

    expect(await screen.findByText('No web-enabled configurations were detected for this backend.')).toBeInTheDocument()
    expect(screen.getByText('Model')).toBeInTheDocument()
    expect(screen.getByText('Options')).toBeInTheDocument()
    expect(screen.queryByText('Appearance')).not.toBeInTheDocument()
  })

  test('does not render when panel is closed', () => {
    vi.mocked(useLayoutStore).mockReturnValue({
      rightPanel: null,
      closeRightPanel: mockCloseRightPanel,
      openRightPanel: mockOpenRightPanel,
    })

    render(<SettingsPanel />)

    expect(screen.queryByText('Config')).not.toBeInTheDocument()
  })

  test('renders current config and card-based config options, then applies the selected config', async () => {
    const user = userEvent.setup()

    mockApplyConfigPreset.mockResolvedValue({
      accepted: true,
      message: 'Preset switch scheduled.',
      config_path: 'configs/config_preset_max_quality.yml',
      backend_url: 'http://localhost:8000',
      frontend_url: 'http://localhost:3005',
      operation_id: null,
    })
    mockGetProviderStatus.mockResolvedValue({
      generated_at: '2026-04-07T01:00:00Z',
      can_run_research: true,
      missing_requirements: [],
      runtime_window_minutes: 360,
      providers: [],
      workers: [],
      config_presets: [
        {
          id: 'preset_current_setup',
          name: 'current local web setup',
          config_path: 'configs/config_preset_current_setup.yml',
          description: 'Mirror the current local setup.',
          kind: 'preset',
          recommended: false,
          current: true,
        },
        {
          id: 'preset_max_quality',
          name: 'maximum quality / unconstrained latency and cost',
          config_path: 'configs/config_preset_max_quality.yml',
          description: 'Highest-quality configuration that still fits the current AI-Q architecture.',
          kind: 'preset',
          recommended: true,
          current: false,
        },
      ],
      config_runtime: {
        current_config_path: 'configs/config_preset_current_setup.yml',
        current_config_name: 'current local web setup',
        current_preset_id: 'preset_current_setup',
        can_apply_presets: true,
        apply_requires_restart: true,
        local_stack_running: true,
        backend_port: 8000,
        frontend_port: 3005,
        next_port: 3201,
      },
    })

    render(<SettingsPanel />)

    expect(await screen.findByText('Current Research Setup')).toBeInTheDocument()
    expect(screen.getAllByText('Current Setup Mirror').length).toBeGreaterThan(0)
    expect(screen.getByText('Choose Research Configuration')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /maximum quality/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /maximum quality/i }))
    await user.click(screen.getByRole('button', { name: /apply selected configuration/i }))

    expect(mockApplyConfigPreset).toHaveBeenCalledWith('configs/config_preset_max_quality.yml')
  })

  test('renders knowledge options and applies them from the options tab', async () => {
    const user = userEvent.setup()

    mockGetLocalResearchOptions.mockResolvedValue({
      supported: true,
      local_stack_running: true,
      can_edit: true,
      requires_reload: true,
      config_path: 'configs/config_preset_current_setup.yml',
      generated_config_path: 'configs/generated/config_runtime_config_preset_current_setup.yml',
      knowledge_layer_enabled: false,
      generate_summary: false,
      top_k: 5,
      min_total_sources_retrieved: 0,
      min_total_cited_sources: 0,
      notes: [
        'Top K applies to future retrieval calls after the backend reloads.',
        'Generate Summary affects newly uploaded or re-ingested files. Existing files keep their current summary state.',
      ],
    })
    mockApplyLocalResearchOptions.mockResolvedValue({
      accepted: true,
      message: 'Research option changes scheduled.',
      config_path: 'configs/generated/config_runtime_config_preset_current_setup.yml',
      backend_url: 'http://localhost:8000',
      frontend_url: 'http://localhost:3005',
      operation_id: null,
      options: {
        supported: true,
        local_stack_running: true,
        can_edit: true,
        requires_reload: true,
        config_path: 'configs/generated/config_runtime_config_preset_current_setup.yml',
        generated_config_path: 'configs/generated/config_runtime_config_preset_current_setup.yml',
        knowledge_layer_enabled: true,
        generate_summary: true,
        top_k: 9,
        min_total_sources_retrieved: 120,
        min_total_cited_sources: 12,
        notes: [
          'Top K applies to future retrieval calls after the backend reloads.',
          'Generate Summary affects newly uploaded or re-ingested files. Existing files keep their current summary state.',
        ],
      },
    })

    render(<SettingsPanel />)

    await user.click(screen.getByText('Options'))

    expect(await screen.findByText('Research Runtime Options')).toBeInTheDocument()
    expect(screen.getByText('Knowledge Layer')).toBeInTheDocument()
    expect(screen.getByText('Generate Summary')).toBeInTheDocument()
    expect(screen.getByText('Top K')).toBeInTheDocument()
    expect(screen.getByText('Minimum Total Sources Retrieved')).toBeInTheDocument()
    expect(screen.getByText('Minimum Total Cited Sources')).toBeInTheDocument()

    await user.click(screen.getByRole('switch', { name: /toggle knowledge layer/i }))
    await user.click(screen.getByRole('switch', { name: /toggle generate summary/i }))

    const topKInput = screen.getByLabelText(/top k retrieval count/i)
    await user.clear(topKInput)
    await user.type(topKInput, '9')

    const minRetrievedInput = screen.getByLabelText(/minimum total sources retrieved/i)
    await user.clear(minRetrievedInput)
    await user.type(minRetrievedInput, '120')

    const minCitedInput = screen.getByLabelText(/minimum total cited sources/i)
    await user.clear(minCitedInput)
    await user.type(minCitedInput, '12')

    await user.click(screen.getByRole('button', { name: /save research options/i }))

    expect(mockApplyLocalResearchOptions).toHaveBeenCalledWith({
      knowledge_layer_enabled: true,
      generate_summary: true,
      top_k: 9,
      min_total_sources_retrieved: 120,
      min_total_cited_sources: 12,
    })
  })

  test('updates the Tavily API key from the options tab', async () => {
    const user = userEvent.setup()

    mockUpdateLocalTavilyApiKey.mockResolvedValue({
      accepted: true,
      message: 'Tavily API key saved.',
      config_path: 'configs/config_preset_current_setup.yml',
      backend_url: 'http://localhost:8000',
      frontend_url: 'http://localhost:3005',
      operation_id: null,
      status: {
        local_stack_running: true,
        can_edit: true,
        requires_reload: true,
        env_path: 'deploy/.env',
        configured: true,
        key_hint: '••••wxyz',
        notes: ['Saving a new Tavily key reloads the local backend.'],
      },
    })

    render(<SettingsPanel />)

    await user.click(screen.getByText('Options'))

    expect(await screen.findByText('Tavily Search Key')).toBeInTheDocument()

    const tavilyInput = screen.getByPlaceholderText(/replacement tavily api key/i)
    await user.type(tavilyInput, 'tvly-new-key')
    await user.click(screen.getByRole('button', { name: /save tavily api key/i }))

    expect(mockUpdateLocalTavilyApiKey).toHaveBeenCalledWith({ api_key: 'tvly-new-key' })
  })

  test('renders generated runtime configs with a friendly current-config label', async () => {
    mockGetProviderStatus.mockResolvedValue({
      generated_at: '2026-04-07T01:00:00Z',
      can_run_research: true,
      missing_requirements: [],
      runtime_window_minutes: 360,
      providers: [],
      workers: [],
      config_presets: [
        {
          id: 'preset_frontier_gpt54_xhigh',
          name: 'frontier hybrid with GPT-5.4 xhigh',
          config_path: 'configs/config_preset_frontier_gpt54_xhigh.yml',
          description: 'Best practical quality/latency balance on the current branch.',
          kind: 'preset',
          recommended: false,
          current: false,
        },
      ],
      config_runtime: {
        current_config_path: '/tmp/nat_configdfpqk2r.yml',
        current_config_name: 'nat_configdfpqk2r.yml',
        current_preset_id: null,
        can_apply_presets: false,
        apply_requires_restart: true,
        local_stack_running: false,
        backend_port: null,
        frontend_port: null,
        next_port: null,
      },
    })

    render(<SettingsPanel />)

    expect(await screen.findByText('Generated Runtime Config')).toBeInTheDocument()
    expect(screen.getByText('/tmp/nat_configdfpqk2r.yml')).toBeInTheDocument()
  })

  test('keeps the source preset selected when the backend runs a generated runtime config', async () => {
    mockGetProviderStatus.mockResolvedValue({
      generated_at: '2026-04-07T01:00:00Z',
      can_run_research: true,
      missing_requirements: [],
      runtime_window_minutes: 360,
      providers: [],
      workers: [],
      config_presets: [
        {
          id: 'preset_web_default_llamaindex',
          name: 'balanced web default',
          config_path: 'configs/config_web_default_llamaindex.yml',
          description: 'Balanced default.',
          kind: 'repo_config',
          recommended: false,
          current: false,
        },
        {
          id: 'preset_max_quality',
          name: 'maximum quality / unconstrained latency and cost',
          config_path: 'configs/config_preset_max_quality.yml',
          description: 'Highest-quality configuration that still fits the current AI-Q architecture.',
          kind: 'preset',
          recommended: true,
          current: true,
        },
      ],
      config_runtime: {
        current_config_path: 'configs/generated/config_runtime_config_preset_max_quality.yml',
        current_config_name: 'maximum quality / unconstrained latency and cost',
        current_preset_id: 'preset_max_quality',
        can_apply_presets: true,
        apply_requires_restart: true,
        local_stack_running: true,
        backend_port: 8000,
        frontend_port: 3005,
        next_port: 3201,
      },
    })

    render(<SettingsPanel />)

    expect(await screen.findAllByText('Maximum Quality')).not.toHaveLength(0)
    expect(screen.getByText('Runtime File')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /apply selected configuration/i })).toHaveTextContent('Already Running')
  })
})
