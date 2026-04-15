// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Application Providers
 *
 * Wraps the application with necessary providers:
 * - AppConfigProvider (runtime server-side config)
 * - ThemeProvider (KUI dark/light mode)
 * - SessionProvider (NextAuth)
 * - ActiveCollectionSync (keeps project/session file collections hydrated)
 * - DeepResearchRestorer (checks for active deep research jobs on mount)
 */

'use client'

import { type ReactNode, useEffect, useRef } from 'react'
import { SessionProvider } from 'next-auth/react'
import { ThemeProvider } from '@/adapters/ui'
import { createProjectsClient, type ProjectFromAPI, type SessionFromAPI } from '@/adapters/api'
import { useAuth } from '@/adapters/auth'
import { ActiveCollectionSync } from '@/features/documents'
import { AppConfigProvider, type AppConfig } from '@/shared/context'
import { useLayoutStore } from '@/features/layout'
import type { Conversation } from '@/features/chat'
import { useChatStore } from '@/features/chat/store'
import { useProjectsStore, type Project } from '@/features/projects'
import type { ThemeMode } from '@/features/layout'

interface ProvidersProps {
  children: ReactNode
  /** Runtime configuration from server-side environment variables */
  config: AppConfig
}

/**
 * Applies theme classes directly to the document element.
 * This ensures theme changes happen without remounting the component tree.
 */
const useThemeEffect = (theme: ThemeMode): void => {
  useEffect(() => {
    const root = document.documentElement

    // Remove existing theme classes
    root.classList.remove('nv-light', 'nv-dark')

    if (theme === 'system') {
      // Check system preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      root.classList.add(prefersDark ? 'nv-dark' : 'nv-light')

      // Listen for system theme changes
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      const handleChange = (e: MediaQueryListEvent): void => {
        root.classList.remove('nv-light', 'nv-dark')
        root.classList.add(e.matches ? 'nv-dark' : 'nv-light')
      }
      mediaQuery.addEventListener('change', handleChange)
      return () => mediaQuery.removeEventListener('change', handleChange)
    } else {
      // Apply explicit theme
      root.classList.add(theme === 'dark' ? 'nv-dark' : 'nv-light')
    }
  }, [theme])
}

/**
 * Hook to fetch data sources on app initialization.
 * Loads available data sources from the API and updates the layout store.
 * Restores the last saved selection when available, otherwise falls back to API defaults.
 */
const useDataSourcesInit = (): void => {
  const fetchDataSources = useLayoutStore((state) => state.fetchDataSources)
  const availableDataSources = useLayoutStore((state) => state.availableDataSources)

  useEffect(() => {
    // Only fetch if not already loaded
    if (availableDataSources === null) {
      fetchDataSources()
    }
  }, [fetchDataSources, availableDataSources])
}

/**
 * Restores per-session data source toggles after the initial API fetch.
 * fetchDataSources initializes the layout store before the chat store has restored
 * the active conversation. This hook reapplies the stored per-session selection
 * once both sides are hydrated.
 * Waits for both availableDataSources and a restored conversation before restoring.
 */
const useDataSourceSessionRestore = (): void => {
  const availableDataSources = useLayoutStore((state) => state.availableDataSources)
  const setEnabledDataSources = useLayoutStore((state) => state.setEnabledDataSources)
  const conversationId = useChatStore((state) => state.currentConversation?.id)
  const restoredRef = useRef(false)

  useEffect(() => {
    if (restoredRef.current || !availableDataSources) return

    const conversation = useChatStore.getState().currentConversation
    if (!conversation) return

    const savedIds = conversation.enabledDataSourceIds
    if (savedIds) {
      const availableIds = new Set(availableDataSources.map((s) => s.id))
      const validIds = savedIds.filter((id) => availableIds.has(id))
      setEnabledDataSources(validIds)
    }

    restoredRef.current = true
  }, [availableDataSources, conversationId, setEnabledDataSources])
}

/**
 * Theme wrapper that syncs with layout store.
 * Applies theme classes directly to document for instant updates.
 * Uses defer prop to prevent hydration mismatches.
 */
const ThemeWrapper = ({ children }: { children: ReactNode }): ReactNode => {
  const theme = useLayoutStore((state) => state.theme)

  // Apply theme classes directly to document
  useThemeEffect(theme)

  // Initialize data sources
  useDataSourcesInit()

  // Restore per-session data source toggles after initial fetch
  useDataSourceSessionRestore()

  return (
    <ThemeProvider theme={theme} global defer>
      {children}
    </ThemeProvider>
  )
}

const parseDateValue = (value: unknown): Date => {
  if (value instanceof Date) return value
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  return new Date()
}

const reviveDates = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(reviveDates)
  }
  if (!value || typeof value !== 'object') {
    return value
  }

  const record = value as Record<string, unknown>
  return Object.fromEntries(
    Object.entries(record).map(([key, childValue]) => {
      if (
        typeof childValue === 'string' &&
        (key === 'timestamp' || key.endsWith('At') || key.endsWith('_at')) &&
        !Number.isNaN(Date.parse(childValue))
      ) {
        return [key, new Date(childValue)]
      }
      return [key, reviveDates(childValue)]
    })
  )
}

const mapProjectFromAPI = (project: ProjectFromAPI): Project => ({
  id: project.id,
  ownerId: project.owner_id,
  title: project.title,
  description: project.description ?? null,
  knowledgeCollectionName: project.knowledge_collection_name,
  createdAt: parseDateValue(project.created_at),
  updatedAt: parseDateValue(project.updated_at),
})

const mapConversationFromAPI = (userId: string, session: SessionFromAPI): Conversation => {
  const snapshot = session.snapshot
  const messages = Array.isArray(snapshot?.messages)
    ? (reviveDates(snapshot.messages) as Conversation['messages'])
    : []

  return {
    id: session.id,
    userId,
    projectId: session.project_id,
    title: session.title,
    messages,
    createdAt: parseDateValue(session.created_at),
    updatedAt: parseDateValue(session.updated_at),
    knowledgeCollectionName: session.knowledge_collection_name,
    knowledgeCollectionNameOverride: session.knowledge_collection_name_override ?? null,
    enabledDataSourceIds: snapshot?.enabled_data_source_ids ?? [],
  }
}

const ProjectStateHydrator = ({ children }: { children: ReactNode }): ReactNode => {
  const { user, idToken } = useAuth()
  const setProjects = useProjectsStore((state) => state.setProjects)
  const setCurrentProjectId = useProjectsStore((state) => state.setCurrentProjectId)
  const markHydrated = useProjectsStore((state) => state.markHydrated)
  const setSyncing = useProjectsStore((state) => state.setSyncing)
  const setProjectsError = useProjectsStore((state) => state.setError)
  const currentProjectId = useProjectsStore((state) => state.currentProjectId)

  const replaceUserConversations = useChatStore((state) => state.replaceUserConversations)
  const currentConversation = useChatStore((state) => state.currentConversation)

  const hydratedUserRef = useRef<string | null>(null)
  const snapshotSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const userId = user?.id
    if (!userId) {
      markHydrated(false)
      hydratedUserRef.current = null
      return
    }

    if (hydratedUserRef.current === userId) {
      return
    }

    let cancelled = false

    const hydrate = async () => {
      setSyncing(true)
      setProjectsError(null)

      try {
        const client = createProjectsClient({ authToken: idToken })
        const projects = await client.listProjects()

        if (cancelled) return

        const mappedProjects = projects.map(mapProjectFromAPI)
        const mappedProjectConversations = projects.flatMap((project) =>
          project.sessions.map((session) => mapConversationFromAPI(userId, session))
        )
        const localRootConversations = useChatStore
          .getState()
          .getUserConversations()
          .filter((conversation) => !conversation.projectId)
          .map((conversation) => ({
            ...conversation,
            createdAt: parseDateValue(conversation.createdAt),
            updatedAt: parseDateValue(conversation.updatedAt),
          }))
        const mergedConversations = [...mappedProjectConversations, ...localRootConversations]

        setProjects(mappedProjects)

        const preferredConversationId =
          currentConversation?.userId === userId ? currentConversation.id : null
        replaceUserConversations(
          userId,
          mergedConversations,
          preferredConversationId ?? undefined
        )

        const nextProjectId =
          mergedConversations.find((conversation) => conversation.id === preferredConversationId)?.projectId ??
          currentProjectId

        setCurrentProjectId(nextProjectId ?? null)
        hydratedUserRef.current = userId
        markHydrated(true)
      } catch (error) {
        if (!cancelled) {
          setProjectsError(error instanceof Error ? error.message : 'Failed to load projects')
          markHydrated(true)
        }
      } finally {
        if (!cancelled) {
          setSyncing(false)
        }
      }
    }

    void hydrate()

    return () => {
      cancelled = true
    }
  }, [
    user?.id,
    idToken,
    currentConversation?.id,
    currentConversation?.projectId,
    currentProjectId,
    setProjects,
    setCurrentProjectId,
    setProjectsError,
    setSyncing,
    markHydrated,
    replaceUserConversations,
  ])

  useEffect(() => {
    if (!user?.id || !currentConversation?.id || !currentConversation.projectId) {
      return
    }

    if (snapshotSyncTimeoutRef.current) {
      clearTimeout(snapshotSyncTimeoutRef.current)
    }

    snapshotSyncTimeoutRef.current = setTimeout(() => {
      const client = createProjectsClient({ authToken: idToken })
      const messages = JSON.parse(JSON.stringify(currentConversation.messages)) as Array<Record<string, unknown>>
      void (async () => {
        try {
          await client.createSession(currentConversation.projectId!, {
            id: currentConversation.id,
            title: currentConversation.title,
            knowledge_collection_name_override: currentConversation.knowledgeCollectionNameOverride ?? null,
            created_at: new Date(currentConversation.createdAt).toISOString(),
            updated_at: new Date(currentConversation.updatedAt).toISOString(),
          })
          await client.putSessionSnapshot(currentConversation.id, {
            messages,
            enabled_data_source_ids: currentConversation.enabledDataSourceIds ?? [],
            updated_at: new Date().toISOString(),
          })
        } catch {
          // Snapshot sync is best-effort; the next edit will retry.
        }
      })()
    }, 300)

    return () => {
      if (snapshotSyncTimeoutRef.current) {
        clearTimeout(snapshotSyncTimeoutRef.current)
        snapshotSyncTimeoutRef.current = null
      }
    }
  }, [
    user?.id,
    idToken,
    currentConversation?.id,
    currentConversation?.projectId,
    currentConversation?.messages,
    currentConversation?.enabledDataSourceIds,
  ])

  return <>{children}</>
}

/**
 * Restores deep research state on conversation load.
 * - Reconnects to running/submitted jobs for page refresh recovery.
 * - Cleans up orphaned 'starting' banners by polling job status via REST.
 * Completed jobs are loaded on-demand via "View Report" click.
 */
const DeepResearchRestorer = ({ children }: { children: ReactNode }): ReactNode => {
  const reconnectToActiveJob = useChatStore((state) => state.reconnectToActiveJob)
  const cleanupOrphanedStartingBanners = useChatStore(
    (state) => state.cleanupOrphanedStartingBanners
  )
  const currentConversationId = useChatStore((state) => state.currentConversation?.id)
  const isDeepResearchStreaming = useChatStore((state) => state.isDeepResearchStreaming)

  useEffect(() => {
    if (!currentConversationId || isDeepResearchStreaming) return

    const restore = async () => {
      await reconnectToActiveJob()
      await cleanupOrphanedStartingBanners()
    }
    void restore()
  }, [
    currentConversationId,
    isDeepResearchStreaming,
    reconnectToActiveJob,
    cleanupOrphanedStartingBanners,
  ])

  return <>{children}</>
}

export const Providers = ({ children, config }: ProvidersProps): ReactNode => {
  const content = (
    <ThemeWrapper>
      <ProjectStateHydrator>
        <ActiveCollectionSync />
        <DeepResearchRestorer>{children}</DeepResearchRestorer>
      </ProjectStateHydrator>
    </ThemeWrapper>
  )

  return (
    <AppConfigProvider config={config}>
      <SessionProvider
        refetchInterval={config.authRequired ? 4 * 60 : 0}
        refetchOnWindowFocus={config.authRequired}
        refetchWhenOffline={false}
      >
        {content}
      </SessionProvider>
    </AppConfigProvider>
  )
}
