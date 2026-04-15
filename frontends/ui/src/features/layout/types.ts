// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Layout Feature Types
 *
 * Type definitions for the main app layout including sidebars and panels.
 */

import type { DataSourceFromAPI } from '@/adapters/api'

/** Theme mode options */
export type ThemeMode = 'light' | 'dark' | 'system'

/** Panels that can be opened on the right side */
export type RightPanelType = 'research' | 'data-sources' | 'providers' | 'settings' | null

/** Tabs within the Research panel */
export type ResearchPanelTab = 'plan' | 'tasks' | 'thinking' | 'citations' | 'report'

/** Display modes for the Research panel */
export type ResearchPanelMode = 'split' | 'full-width'

/** Default split width for the Research panel */
export const DEFAULT_RESEARCH_PANEL_WIDTH_PERCENT = 60
/** Minimum width allowed while dragging the Research panel */
export const MIN_RESEARCH_PANEL_WIDTH_PERCENT = 36
/** Maximum width allowed while dragging the Research panel */
export const MAX_RESEARCH_PANEL_WIDTH_PERCENT = 100

/** Tabs within the DataSources panel */
export type DataSourcesPanelTab = 'connections' | 'files'

/** Layout state for managing panels */
export interface LayoutState {
  /** Whether the sessions panel is open (left side) */
  isSessionsPanelOpen: boolean
  /** Currently open right panel (null = closed) */
  rightPanel: RightPanelType
  /** Active tab in the research panel */
  researchPanelTab: ResearchPanelTab
  /** Whether the research panel shares space with chat or takes the full workspace */
  researchPanelMode: ResearchPanelMode
  /** Width of the research panel when open, expressed as a percentage of the workspace */
  researchPanelWidthPercent: number
  /** Whether the research panel is currently being resized */
  isResearchPanelResizing: boolean
  /** Active tab in the data sources panel */
  dataSourcesPanelTab: DataSourcesPanelTab
  /** IDs of enabled data sources (array for zustand serialization) */
  enabledDataSourceIds: string[]
  /** Current theme mode */
  theme: ThemeMode
  /** Dynamic data sources from API (null = not loaded yet) */
  availableDataSources: DataSourceFromAPI[] | null
  /** Whether the knowledge layer (file upload) is available */
  knowledgeLayerAvailable: boolean
  /** Whether data sources are being fetched */
  dataSourcesLoading: boolean
  /** Error message if data sources fetch failed */
  dataSourcesError: string | null
  /**
   * @deprecated Use researchPanelTab instead
   */
  detailsPanelTab: ResearchPanelTab
  /**
   * @deprecated Use dataSourcesPanelTab instead
   */
  dataSourcePanelTab: DataSourcesPanelTab
}

/** Layout actions for state management */
export interface LayoutActions {
  /** Toggle sessions panel open/closed */
  toggleSessionsPanel: () => void
  /** Set sessions panel state */
  setSessionsPanelOpen: (open: boolean) => void
  /** Directly set the open right panel */
  setRightPanel: (panel: RightPanelType) => void
  /** Open a specific right panel (closes any existing) */
  openRightPanel: (panel: RightPanelType) => void
  /** Close the right panel */
  closeRightPanel: () => void
  /** Set the active research panel tab */
  setResearchPanelTab: (tab: ResearchPanelTab) => void
  /** Set the active research panel display mode */
  setResearchPanelMode: (mode: ResearchPanelMode) => void
  /** Set the current research panel width percentage */
  setResearchPanelWidthPercent: (percent: number) => void
  /** Track whether the research panel is being actively resized */
  setResearchPanelResizing: (resizing: boolean) => void
  /** Set the active data sources panel tab */
  setDataSourcesPanelTab: (tab: DataSourcesPanelTab) => void
  /** Toggle a data source enabled/disabled by ID */
  toggleDataSource: (id: string) => void
  /** Set all enabled data sources */
  setEnabledDataSources: (ids: string[]) => void
  /** Set the theme mode */
  setTheme: (theme: ThemeMode) => void
  /** Fetch data sources from API and restore the last saved source selection when possible */
  fetchDataSources: (authToken?: string) => Promise<void>
  /** Disable all non-web sources (keep only web_search enabled) */
  disableNonWebSources: () => void
  /** Set available data sources (from API) */
  setAvailableDataSources: (sources: DataSourceFromAPI[]) => void
  /** Set knowledge layer availability */
  setKnowledgeLayerAvailable: (available: boolean) => void
  /**
   * @deprecated Use setResearchPanelTab instead
   */
  setDetailsPanelTab: (tab: ResearchPanelTab) => void
  /**
   * @deprecated Use setDataSourcesPanelTab instead
   */
  setDataSourcePanelTab: (tab: DataSourcesPanelTab) => void
}

/** Combined layout store type */
export type LayoutStore = LayoutState & LayoutActions
