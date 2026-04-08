// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * DataSourcesPanel Component
 *
 * Right-side panel for managing data sources and file uploads.
 * Contains two tabs: Data Connections (API sources) and File Sources (uploaded files).
 */

'use client'

import { type FC, useCallback, useMemo } from 'react'
import { Flex, Text, SidePanel, SegmentedControl, Switch, Button, Banner, Badge } from '@/adapters/ui'
import { Globe, LoadingSpinner } from '@/adapters/ui/icons'
import { useAuth } from '@/adapters/auth'
import { useLayoutStore } from '../store'
import { useIsCurrentSessionBusy, useChatStore } from '@/features/chat'
import { resolveKnowledgeCollectionName } from '@/features/chat/lib/resolve-knowledge-collection'
import { type DataSource, WEB_SEARCH_SOURCE_ID } from '../data-sources'
import { DataConnectionCard } from './DataConnectionCard'
import { FileSourcesTab } from './FileSourcesTab'
import { UploadOrchestrator } from '@/features/documents'
import type { DataSourcesPanelTab } from '../types'
import { useProjectsStore } from '@/features/projects'

interface DataSourcesPanelProps {
  /** Callback when source enabled state changes */
  onSourceToggle?: (sourceId: string, enabled: boolean) => void
  /** Callback when a file is deleted */
  onDeleteFile?: (id: string) => void
}

/**
 * Panel for managing data sources and file uploads.
 * Opens from the right side of the screen.
 */
export const DataSourcesPanel: FC<DataSourcesPanelProps> = ({ onSourceToggle, onDeleteFile }) => {
  const { idToken, authRequired } = useAuth()
  const currentConversation = useChatStore((state) => state.currentConversation)
  const saveDataSourcesToConversation = useChatStore((state) => state.saveDataSourcesToConversation)
  const currentProject = useProjectsStore((state) => {
    const targetProjectId = currentConversation
      ? currentConversation.projectId ?? null
      : state.currentProjectId
    if (!targetProjectId) {
      return null
    }
    return state.projects.find((project) => project.id === targetProjectId) ?? null
  })

  const {
    rightPanel,
    closeRightPanel,
    openRightPanel,
    dataSourcesPanelTab,
    setDataSourcesPanelTab,
    enabledDataSourceIds,
    toggleDataSource,
    setEnabledDataSources,
    availableDataSources,
    dataSourcesLoading,
    dataSourcesError,
    fetchDataSources,
  } = useLayoutStore()

  // Check if current session is busy with operations
  const isBusy = useIsCurrentSessionBusy()

  const isOpen = rightPanel === 'data-sources'
  const currentCollectionName = resolveKnowledgeCollectionName(
    currentConversation,
    currentProject?.knowledgeCollectionName
  )
  const isProjectScope = Boolean(currentProject)
  const filesFooterCopy = isProjectScope
    ? 'Files in project memory stay available across sessions in this project until deleted.'
    : 'Files in this standalone chat stay only in this chat and are not reused by projects or other chats.'

  // Check if user has valid auth token
  const hasValidToken = !!idToken

  // Convert array to Set for efficient lookups
  const enabledSourcesSet = new Set(enabledDataSourceIds)

  // Convert API data sources to UI format - no fallback
  const displaySources: DataSource[] = useMemo(() => {
    if (!availableDataSources || availableDataSources.length === 0) {
      return []
    }
    return availableDataSources.map((source) => ({
      id: source.id,
      name: source.name,
      description: source.description ?? '',
      category: source.category ?? 'enterprise',
      defaultEnabled: source.default_enabled ?? source.id === WEB_SEARCH_SOURCE_ID,
      requiresAuth: source.requires_auth ?? false,
    }))
  }, [availableDataSources])

  // Check if any configured sources require user authentication in the UI
  const hasAuthenticatedSources = useMemo(() => {
    return displaySources.some((source) => source.requiresAuth)
  }, [displaySources])

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        openRightPanel('data-sources')
      } else {
        closeRightPanel()
      }
    },
    [openRightPanel, closeRightPanel]
  )

  const handleToggle = useCallback(
    (sourceId: string, enabled: boolean) => {
      const updatedIds = enabled
        ? [...enabledDataSourceIds, sourceId]
        : enabledDataSourceIds.filter((id) => id !== sourceId)
      toggleDataSource(sourceId)
      saveDataSourcesToConversation(updatedIds)
      onSourceToggle?.(sourceId, enabled)
    },
    [toggleDataSource, enabledDataSourceIds, saveDataSourcesToConversation, onSourceToggle]
  )

  const handleTabChange = useCallback(
    (value: string) => {
      setDataSourcesPanelTab(value as DataSourcesPanelTab)

      // Refresh files from backend when switching to the files tab
      // to detect backend-side removals (e.g. TTL cleanup)
      if (value === 'files' && currentCollectionName) {
        const collectionName = currentCollectionName
        if (collectionName) {
          UploadOrchestrator.refreshFilesForSession(collectionName)
        }
      }
    },
    [currentCollectionName, setDataSourcesPanelTab]
  )

  // Get only sources available to the current auth state
  const availableSources = useMemo(() => {
    return displaySources.filter((source) => !source.requiresAuth || hasValidToken)
  }, [displaySources, hasValidToken])

  // Count enabled sources from the store (only count available ones)
  const enabledAvailableCount = enabledDataSourceIds.filter((id) =>
    availableSources.some((s) => s.id === id)
  ).length
  const availableCount = availableSources.length
  const allAvailableEnabled = enabledAvailableCount === availableCount && availableCount > 0

  const handleToggleAll = useCallback(() => {
    const updatedIds = allAvailableEnabled ? [] : availableSources.map((s) => s.id)
    setEnabledDataSources(updatedIds)
    saveDataSourcesToConversation(updatedIds)
  }, [allAvailableEnabled, setEnabledDataSources, availableSources, saveDataSourcesToConversation])

  return (
    <SidePanel
      className="bg-surface-base top-[var(--header-height)] h-[calc(100vh-var(--header-height))] w-[406px] rounded-l-2xl"
      open={isOpen}
      onOpenChange={handleOpenChange}
      side="right"
      bordered
      closeOnClickOutside={false}
      style={
        {
          height: 'calc(100vh - 3.5rem)',
        } as React.CSSProperties
      }
      slotHeading={
        <Flex direction="col" gap="2" className="min-w-0">
          <Flex align="center" gap="2">
            <Globe className="h-5 w-5" />
            Data Sources
          </Flex>
          <Flex align="center" gap="2" className="min-w-0">
            <Badge color="teal">{isProjectScope ? 'Project Memory' : 'Chat Only'}</Badge>
            <Text
              kind="body/regular/xs"
              className="truncate text-subtle"
              title={isProjectScope ? currentProject?.title : 'Standalone chat'}
            >
              {isProjectScope ? currentProject?.title : 'Standalone chat'}
            </Text>
          </Flex>
        </Flex>
      }
      slotFooter={
        dataSourcesPanelTab === 'connections' ? (
          <Text kind="body/regular/xs" className="text-subtle">
            {enabledAvailableCount} of {availableCount} available connections enabled. Enabled
            connections will be available to the AI assistant.
          </Text>
        ) : (
          <Text kind="body/regular/xs" className="text-subtle text-left">
            {filesFooterCopy}
          </Text>
        )
      }
    >
      {/* Tab Navigation */}
      <Flex className="mb-4">
        <SegmentedControl
          value={dataSourcesPanelTab}
          onValueChange={handleTabChange}
          size="small"
          className="w-full"
          items={[
            { value: 'connections', children: 'Connections' },
            { value: 'files', children: 'Files' },
          ]}
        />
      </Flex>

      {/* Tab Content */}
      {dataSourcesPanelTab === 'connections' ? (
        /* Data Sources Tab */
        <Flex direction="col" className="flex-1 overflow-y-auto">
          {/* Auth Warning Banner - shown when authenticated sources exist but no valid token */}
          {hasAuthenticatedSources && !hasValidToken && (
            <Banner
              kind="inline"
              status={!authRequired ? 'info' : 'warning'}
              className="mb-6 px-4 py-3"
            >
              {!authRequired
                ? 'Enable authentication to access additional data sources.'
                : 'Sign in to access additional data sources.'}
            </Banner>
          )}

          {/* All Connections Toggle */}
          <Text kind="label/semibold/xs" className="text-subtle mb-3 uppercase">
            All Connections
          </Text>
          <Flex
            align="center"
            justify="between"
            role="button"
            tabIndex={isBusy ? -1 : 0}
            onClick={isBusy ? undefined : handleToggleAll}
            onKeyDown={(e) => {
              if (!isBusy && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault()
                handleToggleAll()
              }
            }}
            className={`border-base mb-4 rounded-lg border p-3 transition-colors ${
              isBusy ? 'cursor-not-allowed opacity-50' : 'hover:bg-surface-raised-50 cursor-pointer'
            }`}
            aria-pressed={allAvailableEnabled}
            aria-disabled={isBusy}
            aria-label={
              isBusy
                ? 'All available connections (disabled during operations)'
                : `All available connections: ${allAvailableEnabled ? 'enabled' : 'disabled'}`
            }
            title={isBusy ? 'Data source changes disabled during active operations' : undefined}
          >
            <Text kind="label/semibold/sm" className="text-primary">
              Disable / Enable All
            </Text>
            <div onClick={(e) => e.stopPropagation()}>
              <Switch
                size="small"
                checked={allAvailableEnabled}
                onCheckedChange={handleToggleAll}
                disabled={isBusy}
                aria-label={
                  isBusy
                    ? 'Toggle all connections (disabled)'
                    : allAvailableEnabled
                      ? 'Disable all connections'
                      : 'Enable all connections'
                }
              />
            </div>
          </Flex>

          {/* Individual Connections */}
          <Text kind="label/semibold/xs" className="text-subtle mb-3 uppercase">
            Individual Connections ({displaySources.length})
          </Text>

          {dataSourcesLoading ? (
            <Flex align="center" justify="center" className="py-8">
              <LoadingSpinner size="medium" aria-label="Loading data sources" />
            </Flex>
          ) : dataSourcesError ? (
            <Flex direction="col" align="center" className="py-4">
              <Text kind="body/regular/sm" className="text-error mb-2">
                Unable to load data sources
              </Text>
              <Text kind="body/regular/xs" className="text-subtle mb-3">
                {dataSourcesError}
              </Text>
              <Button
                kind="secondary"
                size="small"
                onClick={() => fetchDataSources()}
                aria-label="Retry loading data sources"
              >
                Retry
              </Button>
            </Flex>
          ) : displaySources.length === 0 ? (
            <Flex direction="col" align="center" className="py-4">
              <Text kind="body/regular/sm" className="text-subtle">
                No data sources available
              </Text>
            </Flex>
          ) : (
            <Flex direction="col" gap="2">
              {displaySources.map((source) => {
                const isSourceAvailable = !source.requiresAuth || hasValidToken
                return (
                  <DataConnectionCard
                    key={source.id}
                    source={source}
                    isEnabled={enabledSourcesSet.has(source.id)}
                    isAvailable={isSourceAvailable}
                    isBusy={isBusy}
                    unavailableReason={
                      !isSourceAvailable ? 'Sign in required to access this data source' : undefined
                    }
                    onToggle={handleToggle}
                  />
                )
              })}
            </Flex>
          )}
        </Flex>
      ) : (
        /* File Sources Tab */
        <FileSourcesTab onDeleteFile={onDeleteFile} />
      )}
    </SidePanel>
  )
}
