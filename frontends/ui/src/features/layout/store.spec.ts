// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, test, expect, beforeEach, vi } from 'vitest'
import { DATA_SOURCE_PREFERENCES_KEY } from './lib/data-source-preferences'
import { useLayoutStore } from './store'

const mockDataSourcesClient = vi.hoisted(() => ({
  getDataSources: vi.fn(),
}))

const mockCreateDataSourcesClient = vi.hoisted(() =>
  vi.fn(() => mockDataSourcesClient)
)

vi.mock('@/adapters/api', () => ({
  createDataSourcesClient: mockCreateDataSourcesClient,
}))

describe('useLayoutStore', () => {
  beforeEach(() => {
    localStorage.removeItem(DATA_SOURCE_PREFERENCES_KEY)
    mockDataSourcesClient.getDataSources.mockReset()
    mockCreateDataSourcesClient.mockClear()

    // Reset store to initial state before each test
    useLayoutStore.setState({
      isSessionsPanelOpen: true,
      rightPanel: null,
      researchPanelTab: 'plan',
      researchPanelMode: 'split',
      researchPanelWidthPercent: 60,
      isResearchPanelResizing: false,
      dataSourcesPanelTab: 'connections',
      enabledDataSourceIds: [],
      theme: 'light',
      availableDataSources: null,
      knowledgeLayerAvailable: false,
      dataSourcesLoading: false,
      dataSourcesError: null,
      detailsPanelTab: 'report',
      dataSourcePanelTab: 'connections',
    })
  })

  describe('initial state', () => {
    test('has correct default values', () => {
      const state = useLayoutStore.getState()

      expect(state.isSessionsPanelOpen).toBe(true)
      expect(state.rightPanel).toBeNull()
      expect(state.researchPanelTab).toBe('plan')
      expect(state.researchPanelMode).toBe('split')
      expect(state.researchPanelWidthPercent).toBe(60)
      expect(state.isResearchPanelResizing).toBe(false)
      expect(state.dataSourcesPanelTab).toBe('connections')
      expect(state.theme).toBe('light')
    })
  })

  describe('toggleSessionsPanel', () => {
    test('opens sessions panel when closed', () => {
      useLayoutStore.setState({ isSessionsPanelOpen: false })

      useLayoutStore.getState().toggleSessionsPanel()

      expect(useLayoutStore.getState().isSessionsPanelOpen).toBe(true)
    })

    test('closes sessions panel when open', () => {
      useLayoutStore.setState({ isSessionsPanelOpen: true })

      useLayoutStore.getState().toggleSessionsPanel()

      expect(useLayoutStore.getState().isSessionsPanelOpen).toBe(false)
    })

    test('toggles multiple times correctly', () => {
      useLayoutStore.setState({ isSessionsPanelOpen: false })
      const { toggleSessionsPanel } = useLayoutStore.getState()

      toggleSessionsPanel()
      expect(useLayoutStore.getState().isSessionsPanelOpen).toBe(true)

      toggleSessionsPanel()
      expect(useLayoutStore.getState().isSessionsPanelOpen).toBe(false)

      toggleSessionsPanel()
      expect(useLayoutStore.getState().isSessionsPanelOpen).toBe(true)
    })
  })

  describe('setSessionsPanelOpen', () => {
    test('sets sessions panel to open', () => {
      useLayoutStore.getState().setSessionsPanelOpen(true)

      expect(useLayoutStore.getState().isSessionsPanelOpen).toBe(true)
    })

    test('sets sessions panel to closed', () => {
      useLayoutStore.setState({ isSessionsPanelOpen: true })

      useLayoutStore.getState().setSessionsPanelOpen(false)

      expect(useLayoutStore.getState().isSessionsPanelOpen).toBe(false)
    })

    test('does not notify subscribers when setting the same open state', () => {
      const listener = vi.fn()
      const unsubscribe = useLayoutStore.subscribe(listener)

      useLayoutStore.getState().setSessionsPanelOpen(true)

      expect(listener).not.toHaveBeenCalled()
      unsubscribe()
    })
  })

  describe('openRightPanel', () => {
    test('opens research panel', () => {
      useLayoutStore.getState().openRightPanel('research')

      expect(useLayoutStore.getState().rightPanel).toBe('research')
    })

    test('opens data-sources panel', () => {
      useLayoutStore.getState().openRightPanel('data-sources')

      expect(useLayoutStore.getState().rightPanel).toBe('data-sources')
    })

    test('opens settings panel', () => {
      useLayoutStore.getState().openRightPanel('settings')

      expect(useLayoutStore.getState().rightPanel).toBe('settings')
    })

    test('opens providers panel', () => {
      useLayoutStore.getState().openRightPanel('providers')

      expect(useLayoutStore.getState().rightPanel).toBe('providers')
    })

    test('replaces existing panel', () => {
      useLayoutStore.setState({ rightPanel: 'research' })

      useLayoutStore.getState().openRightPanel('settings')

      expect(useLayoutStore.getState().rightPanel).toBe('settings')
    })

    test('does not notify subscribers when reopening the same panel', () => {
      useLayoutStore.setState({ rightPanel: 'research' })
      const listener = vi.fn()
      const unsubscribe = useLayoutStore.subscribe(listener)

      useLayoutStore.getState().openRightPanel('research')

      expect(listener).not.toHaveBeenCalled()
      unsubscribe()
    })
  })

  describe('closeRightPanel', () => {
    test('closes open panel', () => {
      useLayoutStore.setState({ rightPanel: 'research' })

      useLayoutStore.getState().closeRightPanel()

      expect(useLayoutStore.getState().rightPanel).toBeNull()
    })

    test('handles closing when already closed', () => {
      useLayoutStore.getState().closeRightPanel()

      expect(useLayoutStore.getState().rightPanel).toBeNull()
    })

    test('does not notify subscribers when closing an already closed panel', () => {
      const listener = vi.fn()
      const unsubscribe = useLayoutStore.subscribe(listener)

      useLayoutStore.getState().closeRightPanel()

      expect(listener).not.toHaveBeenCalled()
      unsubscribe()
    })
  })

  describe('setResearchPanelTab', () => {
    test('sets thinking tab', () => {
      useLayoutStore.getState().setResearchPanelTab('thinking')

      expect(useLayoutStore.getState().researchPanelTab).toBe('thinking')
    })

    test('sets citations tab', () => {
      useLayoutStore.getState().setResearchPanelTab('citations')

      expect(useLayoutStore.getState().researchPanelTab).toBe('citations')
    })

    test('sets report tab', () => {
      useLayoutStore.setState({ researchPanelTab: 'thinking' })

      useLayoutStore.getState().setResearchPanelTab('report')

      expect(useLayoutStore.getState().researchPanelTab).toBe('report')
    })
  })

  describe('setResearchPanelMode', () => {
    test('sets split mode', () => {
      useLayoutStore.setState({ researchPanelMode: 'full-width', researchPanelWidthPercent: 100 })

      useLayoutStore.getState().setResearchPanelMode('split')

      expect(useLayoutStore.getState().researchPanelMode).toBe('split')
      expect(useLayoutStore.getState().researchPanelWidthPercent).toBe(60)
    })

    test('sets full width mode', () => {
      useLayoutStore.getState().setResearchPanelMode('full-width')

      expect(useLayoutStore.getState().researchPanelMode).toBe('full-width')
      expect(useLayoutStore.getState().researchPanelWidthPercent).toBe(100)
    })
  })

  describe('setResearchPanelWidthPercent', () => {
    test('updates the width and keeps split mode below 100 percent', () => {
      useLayoutStore.getState().setResearchPanelWidthPercent(72.4)

      expect(useLayoutStore.getState().researchPanelWidthPercent).toBe(72.4)
      expect(useLayoutStore.getState().researchPanelMode).toBe('split')
    })

    test('clamps width and marks the panel full width at 100 percent', () => {
      useLayoutStore.getState().setResearchPanelWidthPercent(140)

      expect(useLayoutStore.getState().researchPanelWidthPercent).toBe(100)
      expect(useLayoutStore.getState().researchPanelMode).toBe('full-width')
    })

    test('enforces a minimum draggable width', () => {
      useLayoutStore.getState().setResearchPanelWidthPercent(10)

      expect(useLayoutStore.getState().researchPanelWidthPercent).toBe(36)
      expect(useLayoutStore.getState().researchPanelMode).toBe('split')
    })
  })

  describe('setResearchPanelResizing', () => {
    test('tracks resize state', () => {
      useLayoutStore.getState().setResearchPanelResizing(true)
      expect(useLayoutStore.getState().isResearchPanelResizing).toBe(true)

      useLayoutStore.getState().setResearchPanelResizing(false)
      expect(useLayoutStore.getState().isResearchPanelResizing).toBe(false)
    })
  })

  describe('setDataSourcesPanelTab', () => {
    test('sets connections tab', () => {
      useLayoutStore.setState({ dataSourcesPanelTab: 'files' })

      useLayoutStore.getState().setDataSourcesPanelTab('connections')

      expect(useLayoutStore.getState().dataSourcesPanelTab).toBe('connections')
    })

    test('sets files tab', () => {
      useLayoutStore.getState().setDataSourcesPanelTab('files')

      expect(useLayoutStore.getState().dataSourcesPanelTab).toBe('files')
    })
  })

  describe('setTheme', () => {
    test('sets light theme', () => {
      useLayoutStore.getState().setTheme('light')

      expect(useLayoutStore.getState().theme).toBe('light')
    })

    test('sets dark theme', () => {
      useLayoutStore.getState().setTheme('dark')

      expect(useLayoutStore.getState().theme).toBe('dark')
    })

    test('sets system theme', () => {
      useLayoutStore.setState({ theme: 'dark' })

      useLayoutStore.getState().setTheme('system')

      expect(useLayoutStore.getState().theme).toBe('system')
    })
  })

  describe('data source persistence', () => {
    test('setEnabledDataSources persists the selection', () => {
      useLayoutStore.getState().setEnabledDataSources(['paper_search', 'web_search'])

      expect(useLayoutStore.getState().enabledDataSourceIds).toEqual([
        'paper_search',
        'web_search',
      ])
      expect(JSON.parse(localStorage.getItem(DATA_SOURCE_PREFERENCES_KEY) ?? 'null')).toEqual([
        'paper_search',
        'web_search',
      ])
    })

    test('fetchDataSources restores the saved preference instead of API defaults', async () => {
      localStorage.setItem(DATA_SOURCE_PREFERENCES_KEY, JSON.stringify(['paper_search']))
      mockDataSourcesClient.getDataSources.mockResolvedValue({
        data_sources: [
          { id: 'web_search', default_enabled: true },
          { id: 'paper_search', default_enabled: false },
        ],
        knowledge_layer: true,
      })

      await useLayoutStore.getState().fetchDataSources()

      expect(mockCreateDataSourcesClient).toHaveBeenCalled()
      expect(useLayoutStore.getState().enabledDataSourceIds).toEqual(['paper_search'])
      expect(useLayoutStore.getState().knowledgeLayerAvailable).toBe(true)
    })

    test('fetchDataSources preserves an explicit empty selection on refetch', async () => {
      useLayoutStore.setState({
        availableDataSources: [
          { id: 'web_search', name: 'Web Search' },
          { id: 'paper_search', name: 'Paper Search' },
        ],
        enabledDataSourceIds: [],
      })
      mockDataSourcesClient.getDataSources.mockResolvedValue({
        data_sources: [
          { id: 'web_search', default_enabled: true },
          { id: 'paper_search', default_enabled: false },
        ],
        knowledge_layer: false,
      })

      await useLayoutStore.getState().fetchDataSources()

      expect(useLayoutStore.getState().enabledDataSourceIds).toEqual([])
    })
  })
})
