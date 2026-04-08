// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * MainLayout Component
 *
 * The main application layout container that orchestrates:
 * - AppBar (top)
 * - SessionsPanel (left, overlay)
 * - ChatArea + InputArea (center, responsive width)
 * - ResearchPanel (right, pushes content - takes 60% when open)
 * - DataSourcesPanel / ProvidersPanel / SettingsPanel (right, overlay)
 *
 * Handles auth state to show different UI for logged-in vs logged-out users.
 */

'use client'

import { type FC, useCallback } from 'react'
import { Flex } from '@/adapters/ui'
import { createProjectsClient } from '@/adapters/api'
import { useAuth } from '@/adapters/auth'
import { useReducedMotion } from '@/hooks/use-reduced-motion'
import { AppBar } from './AppBar'
import { SessionsPanel } from './SessionsPanel'
import { ChatArea } from './ChatArea'
import { InputArea } from './InputArea'
import { ResearchPanel } from './ResearchPanel'
import { DataSourcesPanel } from './DataSourcesPanel'
import { ProvidersPanel } from './ProvidersPanel'
import { SettingsPanel } from './SettingsPanel'
import { useChatStore, useDeepResearch, NoSourcesBanner } from '@/features/chat'
import { hasActiveDeepResearchJob } from '@/features/chat/lib/session-activity'
import { useLayoutStore } from '../store'
import { useSessionUrl } from '@/hooks/use-session-url'
import { useProjectsStore } from '@/features/projects'

interface MainLayoutProps {
  /** Whether the user is authenticated */
  isAuthenticated?: boolean
  /** Whether authentication is required (false = using default user) */
  authRequired?: boolean
  /** User information for AppBar */
  user?: {
    name?: string
    email?: string
    image?: string
  }
  /** Callback when sign in is clicked */
  onSignIn?: () => void
  /** Callback when sign out is clicked */
  onSignOut?: () => void
}

const sortByUpdatedAtDesc = <T extends { updatedAt: Date | string }>(items: T[]): T[] =>
  [...items].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

/**
 * Main application layout with all panels and regions.
 * Manages the overall structure and panel states.
 * Chat state is managed via the useChatStore.
 */
export const MainLayout: FC<MainLayoutProps> = ({
  isAuthenticated = false,
  authRequired = false,
  user,
  onSignIn,
  onSignOut,
}) => {
  const { idToken } = useAuth()
  const currentConversation = useChatStore((state) => state.currentConversation)
  const currentUserId = useChatStore((state) => state.currentUserId)
  const getUserConversations = useChatStore((state) => state.getUserConversations)
  const selectConversation = useChatStore((state) => state.selectConversation)
  const startNewSessionDraft = useChatStore((state) => state.startNewSessionDraft)
  const deleteConversation = useChatStore((state) => state.deleteConversation)
  const updateConversationTitle = useChatStore((state) => state.updateConversationTitle)
  const replaceUserConversations = useChatStore((state) => state.replaceUserConversations)
  const isStreaming = useChatStore((state) => state.isStreaming)
  const pendingInteraction = useChatStore((state) => state.pendingInteraction)
  const isDeepResearchStreaming = useChatStore((state) => state.isDeepResearchStreaming)
  const deepResearchOwnerConversationId = useChatStore((state) => state.deepResearchOwnerConversationId)
  const projects = useProjectsStore((state) => state.projects)
  const currentProjectId = useProjectsStore((state) => state.currentProjectId)
  const setCurrentProjectId = useProjectsStore((state) => state.setCurrentProjectId)
  const upsertProject = useProjectsStore((state) => state.upsertProject)
  const removeProject = useProjectsStore((state) => state.removeProject)

  const { rightPanel, closeRightPanel } = useLayoutStore()
  const prefersReducedMotion = useReducedMotion()

  // Deep research SSE hook - manages connection when deep research starts
  useDeepResearch()

  // Sync session state with URL query parameters
  const { updateRouteUrl } = useSessionUrl({ isAuthenticated })
  const activeScopeProjectId = currentConversation
    ? currentConversation.projectId ?? null
    : currentProjectId ?? null

  const getScopeConversations = useCallback(
    (projectId: string | null) =>
      sortByUpdatedAtDesc(
        getUserConversations().filter((conversation) =>
          projectId ? conversation.projectId === projectId : !conversation.projectId
        )
      ),
    [getUserConversations]
  )

  // Wrap selectConversation to also update URL
  const handleSelectSession = useCallback(
    (sessionId: string) => {
      selectConversation(sessionId)
      const conversation = getUserConversations().find((item) => item.id === sessionId)
      updateRouteUrl(conversation?.projectId ?? null, sessionId)
    },
    [selectConversation, getUserConversations, updateRouteUrl]
  )

  // Start a new draft inside the currently selected scope.
  const handleNewSession = useCallback(() => {
    setCurrentProjectId(activeScopeProjectId)
    startNewSessionDraft()
    updateRouteUrl(activeScopeProjectId, null)
    closeRightPanel()
  }, [
    activeScopeProjectId,
    closeRightPanel,
    setCurrentProjectId,
    startNewSessionDraft,
    updateRouteUrl,
  ])

  // Start a new draft outside any project so no shared project files are carried in.
  const handleNewStandaloneChat = useCallback(() => {
    setCurrentProjectId(null)
    startNewSessionDraft()
    updateRouteUrl(null, null)
    closeRightPanel()
  }, [closeRightPanel, setCurrentProjectId, startNewSessionDraft, updateRouteUrl])

  const projectsClient = createProjectsClient({ authToken: idToken })

  const handleSelectProject = useCallback(
    (projectId: string) => {
      setCurrentProjectId(projectId)
      const nextConversation = getScopeConversations(projectId)[0] ?? null
      if (nextConversation) {
        selectConversation(nextConversation.id)
        updateRouteUrl(projectId, nextConversation.id)
      } else {
        startNewSessionDraft()
        updateRouteUrl(projectId, null)
      }
    },
    [
      getScopeConversations,
      selectConversation,
      setCurrentProjectId,
      startNewSessionDraft,
      updateRouteUrl,
    ]
  )

  const handleSelectStandalone = useCallback(() => {
    setCurrentProjectId(null)
    const standaloneConversations = getScopeConversations(null)
    const currentStandaloneConversation =
      currentConversation && !currentConversation.projectId ? currentConversation : null
    const nextConversation = currentStandaloneConversation ?? standaloneConversations[0] ?? null

    if (nextConversation) {
      selectConversation(nextConversation.id)
      updateRouteUrl(null, nextConversation.id)
    } else {
      startNewSessionDraft()
      updateRouteUrl(null, null)
    }
  }, [
    currentConversation,
    getScopeConversations,
    selectConversation,
    setCurrentProjectId,
    startNewSessionDraft,
    updateRouteUrl,
  ])

  const handleNewProject = useCallback(async () => {
    const created = await projectsClient.createProject({ title: 'New Project' })
    const mappedProject = {
      id: created.id,
      ownerId: created.owner_id,
      title: created.title,
      description: created.description ?? null,
      knowledgeCollectionName: created.knowledge_collection_name,
      createdAt: new Date(created.created_at ?? Date.now()),
      updatedAt: new Date(created.updated_at ?? Date.now()),
    }
    upsertProject(mappedProject)
    setCurrentProjectId(mappedProject.id)
    startNewSessionDraft()
    updateRouteUrl(mappedProject.id, null)
  }, [projectsClient, setCurrentProjectId, startNewSessionDraft, updateRouteUrl, upsertProject])

  const handleRenameProject = useCallback(
    async (projectId: string, title: string) => {
      const updated = await projectsClient.updateProject(projectId, { title })
      upsertProject({
        id: updated.id,
        ownerId: updated.owner_id,
        title: updated.title,
        description: updated.description ?? null,
        knowledgeCollectionName: updated.knowledge_collection_name,
        createdAt: new Date(updated.created_at ?? Date.now()),
        updatedAt: new Date(updated.updated_at ?? Date.now()),
      })
    },
    [projectsClient, upsertProject]
  )

  const handleDeleteProject = useCallback(
    async (projectId: string) => {
      await projectsClient.deleteProject(projectId)
      removeProject(projectId)

      if (currentUserId) {
        const remainingConversations = getUserConversations().filter(
          (conversation) => conversation.projectId !== projectId
        )
        const deletingActiveProject =
          currentProjectId === projectId || currentConversation?.projectId === projectId
        const nextConversation = deletingActiveProject ? remainingConversations[0] ?? null : currentConversation

        replaceUserConversations(currentUserId, remainingConversations, nextConversation?.id ?? null)

        if (deletingActiveProject) {
          const nextProjectId =
            nextConversation?.projectId ??
            projects.find((project) => project.id !== projectId)?.id ??
            null
          setCurrentProjectId(nextProjectId)
          if (nextConversation) {
            updateRouteUrl(nextProjectId, nextConversation.id)
          } else {
            startNewSessionDraft()
            updateRouteUrl(nextProjectId, null)
          }
        } else {
          updateRouteUrl(currentProjectId ?? null, currentConversation?.id ?? null)
        }
      }
    },
    [
      currentConversation?.id,
      currentConversation?.projectId,
      currentUserId,
      currentProjectId,
      getUserConversations,
      projects,
      projectsClient,
      removeProject,
      replaceUserConversations,
      setCurrentProjectId,
      startNewSessionDraft,
      updateRouteUrl,
    ]
  )

  // Wrap deleteConversation to clear URL if deleting current session
  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      const wasCurrentSession = currentConversation?.id === sessionId
      try {
        await projectsClient.deleteSession(sessionId)
      } catch {
        // Local-only sessions may not exist in backend yet.
      }
      deleteConversation(sessionId)
      if (wasCurrentSession) {
        updateRouteUrl(activeScopeProjectId, null)
      }
    },
    [
      activeScopeProjectId,
      currentConversation?.id,
      deleteConversation,
      projectsClient,
      updateRouteUrl,
    ]
  )

  // Delete all sessions in the active scope.
  const handleDeleteAllSessions = useCallback(async () => {
    const sessionIds = getScopeConversations(activeScopeProjectId).map((conversation) => conversation.id)
    if (sessionIds.length === 0) {
      updateRouteUrl(activeScopeProjectId, null)
      return
    }

    await Promise.allSettled(sessionIds.map((sessionId) => projectsClient.deleteSession(sessionId)))
    sessionIds.forEach((sessionId) => deleteConversation(sessionId))
    updateRouteUrl(activeScopeProjectId, null)
  }, [
    activeScopeProjectId,
    deleteConversation,
    getScopeConversations,
    projectsClient,
    updateRouteUrl,
  ])

  // Check if research panel is open (pushes content instead of overlaying)
  const isResearchPanelOpen = rightPanel === 'research'
  const isNavigationBlocked = isStreaming || pendingInteraction !== null

  // Get only conversations for the current authenticated user
  const scopeConversations = getScopeConversations(activeScopeProjectId)
  const activeProject =
    projects.find(
      (project) =>
        project.id === currentConversation?.projectId || project.id === activeScopeProjectId
    ) ?? null

  // Convert conversations to session format for sidebar
  const sessions = scopeConversations.map((conv) => {
    const hasActiveJob = hasActiveDeepResearchJob(conv.messages)

    return {
      id: conv.id,
      title: conv.title,
      date: new Date(conv.updatedAt),
      hasActiveDeepResearch: hasActiveJob || (isDeepResearchStreaming && deepResearchOwnerConversationId === conv.id),
    }
  })

  const projectItems = projects.map((project) => ({
    id: project.id,
    title: project.title,
    date: new Date(project.updatedAt),
  }))

  return (
    <Flex direction="col" className="h-screen min-w-[768px] overflow-x-auto overflow-y-hidden">
      {/* AppBar - Fixed at top */}
      <AppBar
        projectTitle={activeProject?.title ?? undefined}
        sessionTitle={currentConversation?.title || 'New Session'}
        isStandaloneScope={activeScopeProjectId === null}
        isAuthenticated={isAuthenticated}
        authRequired={authRequired}
        user={user}
        onNewSession={handleNewStandaloneChat}
        isNewSessionDisabled={isNavigationBlocked}
        onSignIn={onSignIn}
        onSignOut={onSignOut}
      />

      {/* Main Content Area - using explicit widths instead of flex for smoother animation */}
      <div className="relative flex flex-1 overflow-hidden">
        {/* Center Content: Chat + Input - Responsive to research panel */}
        <div
          className="flex flex-col overflow-hidden"
          style={{
            width: isResearchPanelOpen ? '40%' : '100%',
            transition: prefersReducedMotion ? 'none' : 'width 600ms ease-in-out',
          }}
        >
          {/* Chat Area - Scrollable */}
          <ChatArea isAuthenticated={isAuthenticated} onSignIn={onSignIn} />

          {/* No sources warning - shown when no data sources or files available */}
          <NoSourcesBanner isAuthenticated={isAuthenticated} />

          {/* Input Area - Fixed at bottom of chat */}
          {/* Using WebSocket mode for full HITL (human-in-the-loop) support */}
          <InputArea
            isAuthenticated={isAuthenticated}
            connectionMode="websocket"
          />
        </div>

        {/* Research Panel (Right) - Pushes content, takes 60% width */}
        <ResearchPanel isAuthenticated={isAuthenticated} />
      </div>

      {/* Overlay Panels - These slide over the content */}

      {/* Sessions Panel (Left) - Only functional when authenticated */}
      <SessionsPanel
        projects={projectItems}
        selectedProjectId={activeScopeProjectId ?? undefined}
        isStandaloneScope={activeScopeProjectId === null}
        onSelectStandalone={handleSelectStandalone}
        onSelectProject={handleSelectProject}
        onNewProject={() => {
          void handleNewProject()
        }}
        onDeleteProject={(projectId) => {
          void handleDeleteProject(projectId)
        }}
        onRenameProject={(projectId, title) => {
          void handleRenameProject(projectId, title)
        }}
        sessions={sessions}
        selectedSessionId={currentConversation?.id}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        onDeleteSession={(sessionId) => {
          void handleDeleteSession(sessionId)
        }}
        onDeleteAllSessions={() => {
          void handleDeleteAllSessions()
        }}
        onRenameSession={(sessionId, title) => {
          updateConversationTitle(sessionId, title)
          void projectsClient.updateSession(sessionId, { title }).catch(() => undefined)
        }}
      />

      {/* Data Sources Panel (Right) - Overlay */}
      <DataSourcesPanel />

      {/* Providers Panel (Right) - Overlay */}
      <ProvidersPanel />

      {/* Settings Panel (Right) - Overlay */}
      <SettingsPanel />
    </Flex>
  )
}
