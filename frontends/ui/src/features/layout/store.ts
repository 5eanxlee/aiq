// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Layout Store
 *
 * Zustand store for managing the main app layout state.
 * Controls sidebar visibility and panel states.
 */

import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import {
  DEFAULT_RESEARCH_PANEL_WIDTH_PERCENT,
  MAX_RESEARCH_PANEL_WIDTH_PERCENT,
  MIN_RESEARCH_PANEL_WIDTH_PERCENT,
} from './types'
import type {
  LayoutState,
  LayoutStore,
  RightPanelType,
  ResearchPanelMode,
  ResearchPanelTab,
  DataSourcesPanelTab,
  ThemeMode,
} from './types'
import { createDataSourcesClient, type DataSourceFromAPI } from '@/adapters/api'
import { WEB_SEARCH_SOURCE_ID } from './data-sources'
import { resolvePreferredDataSourceIds, savePreferredDataSourceIds } from './lib/data-source-preferences'

const initialState: LayoutState = {
  isSessionsPanelOpen: true,
  rightPanel: null,
  researchPanelTab: 'plan',
  researchPanelMode: 'split',
  researchPanelWidthPercent: DEFAULT_RESEARCH_PANEL_WIDTH_PERCENT,
  isResearchPanelResizing: false,
  dataSourcesPanelTab: 'connections',
  enabledDataSourceIds: [], // Start empty, populated when data sources are fetched
  theme: 'light',
  availableDataSources: null,
  knowledgeLayerAvailable: false, // Default to false until API confirms availability
  dataSourcesLoading: false,
  dataSourcesError: null,
  // Deprecated aliases for backwards compatibility
  detailsPanelTab: 'report',
  dataSourcePanelTab: 'connections',
}

const clampResearchPanelWidthPercent = (percent: number): number =>
  Number.isFinite(percent)
    ? Math.min(
        MAX_RESEARCH_PANEL_WIDTH_PERCENT,
        Math.max(MIN_RESEARCH_PANEL_WIDTH_PERCENT, Math.round(percent * 10) / 10)
      )
    : DEFAULT_RESEARCH_PANEL_WIDTH_PERCENT

export const useLayoutStore = create<LayoutStore>()(
  devtools(
    (set, get) => ({
      ...initialState,

      toggleSessionsPanel: () =>
        set(
          (state) => ({ isSessionsPanelOpen: !state.isSessionsPanelOpen }),
          false,
          'toggleSessionsPanel'
        ),

      setSessionsPanelOpen: (open: boolean) =>
        set(
          (state) => (state.isSessionsPanelOpen === open ? state : { isSessionsPanelOpen: open }),
          false,
          'setSessionsPanelOpen'
        ),

      setRightPanel: (panel: RightPanelType) =>
        set(
          (state) => (state.rightPanel === panel ? state : { rightPanel: panel }),
          false,
          'setRightPanel'
        ),

      openRightPanel: (panel: RightPanelType) =>
        set(
          (state) => (state.rightPanel === panel ? state : { rightPanel: panel }),
          false,
          'openRightPanel'
        ),

      closeRightPanel: () =>
        set(
          (state) => (state.rightPanel === null ? state : { rightPanel: null }),
          false,
          'closeRightPanel'
        ),

      setResearchPanelTab: (tab: ResearchPanelTab) =>
        set(
          (state) => (state.researchPanelTab === tab ? state : { researchPanelTab: tab }),
          false,
          'setResearchPanelTab'
        ),

      setResearchPanelMode: (mode: ResearchPanelMode) =>
        set(
          (state) => {
            if (state.researchPanelMode === mode) {
              return state
            }

            return {
              researchPanelMode: mode,
              researchPanelWidthPercent:
                mode === 'full-width'
                  ? MAX_RESEARCH_PANEL_WIDTH_PERCENT
                  : state.researchPanelWidthPercent >= MAX_RESEARCH_PANEL_WIDTH_PERCENT
                    ? DEFAULT_RESEARCH_PANEL_WIDTH_PERCENT
                    : state.researchPanelWidthPercent,
            }
          },
          false,
          'setResearchPanelMode'
        ),

      setResearchPanelWidthPercent: (percent: number) =>
        set(
          (state) => {
            const researchPanelWidthPercent = clampResearchPanelWidthPercent(percent)
            const researchPanelMode: ResearchPanelMode =
              researchPanelWidthPercent >= MAX_RESEARCH_PANEL_WIDTH_PERCENT
                ? 'full-width'
                : 'split'

            if (
              state.researchPanelWidthPercent === researchPanelWidthPercent &&
              state.researchPanelMode === researchPanelMode
            ) {
              return state
            }

            return {
              researchPanelWidthPercent,
              researchPanelMode,
            }
          },
          false,
          'setResearchPanelWidthPercent'
        ),

      setResearchPanelResizing: (resizing: boolean) =>
        set(
          (state) =>
            state.isResearchPanelResizing === resizing
              ? state
              : { isResearchPanelResizing: resizing },
          false,
          'setResearchPanelResizing'
        ),

      setDataSourcesPanelTab: (tab: DataSourcesPanelTab) =>
        set(
          (state) => (state.dataSourcesPanelTab === tab ? state : { dataSourcesPanelTab: tab }),
          false,
          'setDataSourcesPanelTab'
        ),

      toggleDataSource: (id: string) =>
        set(
          (state) => {
            const isEnabled = state.enabledDataSourceIds.includes(id)
            const enabledDataSourceIds = isEnabled
              ? state.enabledDataSourceIds.filter((sourceId) => sourceId !== id)
              : [...state.enabledDataSourceIds, id]

            savePreferredDataSourceIds(enabledDataSourceIds)

            return {
              enabledDataSourceIds,
            }
          },
          false,
          'toggleDataSource'
        ),

      setEnabledDataSources: (ids: string[]) =>
        set(
          () => {
            savePreferredDataSourceIds(ids)
            return { enabledDataSourceIds: ids }
          },
          false,
          'setEnabledDataSources'
        ),

      setTheme: (theme: ThemeMode) =>
        set((state) => (state.theme === theme ? state : { theme }), false, 'setTheme'),

      fetchDataSources: async (authToken?: string) => {
        set({ dataSourcesLoading: true, dataSourcesError: null }, false, 'fetchDataSources/start')

        try {
          const client = createDataSourcesClient({ authToken })
          const response = await client.getDataSources()
          const currentEnabledIds = get().availableDataSources
            ? get().enabledDataSourceIds
            : undefined

          // data_sources is already filtered (knowledge_layer removed) by the client
          const enabledIds = resolvePreferredDataSourceIds(
            response.data_sources,
            currentEnabledIds
          )

          set(
            {
              availableDataSources: response.data_sources,
              knowledgeLayerAvailable: response.knowledge_layer,
              enabledDataSourceIds: enabledIds,
              dataSourcesLoading: false,
              dataSourcesError: null,
            },
            false,
            'fetchDataSources/success'
          )
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to fetch data sources'
          set(
            {
              dataSourcesLoading: false,
              dataSourcesError: errorMessage,
            },
            false,
            'fetchDataSources/error'
          )
        }
      },

      disableNonWebSources: () =>
        set(
          (state) => ({
            enabledDataSourceIds: (() => {
              const nextEnabledIds = state.enabledDataSourceIds.filter(
                (id) => id === WEB_SEARCH_SOURCE_ID
              )
              savePreferredDataSourceIds(nextEnabledIds)
              return nextEnabledIds
            })(),
          }),
          false,
          'disableNonWebSources'
        ),

      setAvailableDataSources: (sources: DataSourceFromAPI[]) =>
        set({ availableDataSources: sources }, false, 'setAvailableDataSources'),

      setKnowledgeLayerAvailable: (available: boolean) =>
        set({ knowledgeLayerAvailable: available }, false, 'setKnowledgeLayerAvailable'),

      // Deprecated actions - delegate to new ones
      setDetailsPanelTab: (tab: ResearchPanelTab) =>
        set(
          (state) =>
            state.researchPanelTab === tab && state.detailsPanelTab === tab
              ? state
              : { researchPanelTab: tab, detailsPanelTab: tab },
          false,
          'setDetailsPanelTab'
        ),

      setDataSourcePanelTab: (tab: DataSourcesPanelTab) =>
        set(
          (state) =>
            state.dataSourcesPanelTab === tab && state.dataSourcePanelTab === tab
              ? state
              : { dataSourcesPanelTab: tab, dataSourcePanelTab: tab },
          false,
          'setDataSourcePanelTab'
        ),
    }),
    { name: 'LayoutStore' }
  )
)
