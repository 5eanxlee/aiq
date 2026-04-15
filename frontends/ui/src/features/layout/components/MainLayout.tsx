// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * MainLayout Component
 *
 * The main application layout container that orchestrates:
 * - AppBar (top)
 * - SessionsPanel (left)
 * - ChatArea + InputArea (center)
 * - ResearchPanel (right, push layout)
 * - DataSourcesPanel / ProvidersPanel / SettingsPanel (right overlays)
 */

'use client'

import { type FC, useCallback, useEffect, useMemo } from 'react'
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
import type { ChatMessage } from '@/features/chat'

interface MainLayoutProps {
  isAuthenticated?: boolean
  authRequired?: boolean
  user?: {
    name?: string
    email?: string
    image?: string
  }
  onSignIn?: () => void
  onSignOut?: () => void
}

const sortByUpdatedAtDesc = <T extends { updatedAt: Date | string }>(items: T[]): T[] =>
  [...items].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

const getLatestDeepResearchMessage = (messages: ChatMessage[]): ChatMessage | null => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message.messageType === 'agent_response' && message.deepResearchJobId) {
      return message
    }
  }
  return null
}

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
  const conversations = useChatStore((state) => state.conversations)
  const selectConversation = useChatStore((state) => state.selectConversation)
  const startNewSessionDraft = useChatStore((state) => state.startNewSessionDraft)
  const deleteConversation = useChatStore((state) => state.deleteConversation)
  const updateConversationTitle = useChatStore((state) => state.updateConversationTitle)
  const replaceUserConversations = useChatStore((state) => state.replaceUserConversations)
  const patchConversationMessage = useChatStore((state) => state.patchConversationMessage)
  const addDeepResearchBanner = useChatStore((state) => state.addDeepResearchBanner)
  const persistDeepResearchToSession = useChatStore((state) => state.persistDeepResearchToSession)
  const isStreaming = useChatStore((state) => state.isStreaming)
  const pendingInteraction = useChatStore((state) => state.pendingInteraction)
  const isDeepResearchStreaming = useChatStore((state) => state.isDeepResearchStreaming)
  const deepResearchOwnerConversationId = useChatStore((state) => state.deepResearchOwnerConversationId)

  const projects = useProjectsStore((state) => state.projects)
  const currentProjectId = useProjectsStore((state) => state.currentProjectId)
  const setCurrentProjectId = useProjectsStore((state) => state.setCurrentProjectId)
  const upsertProject = useProjectsStore((state) => state.upsertProject)
  const removeProject = useProjectsStore((state) => state.removeProject)

  const rightPanel = useLayoutStore((state) => state.rightPanel)
  const researchPanelMode = useLayoutStore((state) => state.researchPanelMode)
  const researchPanelWidthPercent = useLayoutStore((state) => state.researchPanelWidthPercent)
  const isResearchPanelResizing = useLayoutStore((state) => state.isResearchPanelResizing)
  const closeRightPanel = useLayoutStore((state) => state.closeRightPanel)
  const prefersReducedMotion = useReducedMotion()

  useDeepResearch()

  const { updateRouteUrl } = useSessionUrl({ isAuthenticated })
  const activeScopeProjectId = currentConversation
    ? currentConversation.projectId ?? null
    : currentProjectId ?? null
  const userConversations = useMemo(
    () =>
      currentUserId
        ? conversations.filter((conversation) => conversation.userId === currentUserId)
        : [],
    [conversations, currentUserId]
  )

  const getScopeConversations = useCallback(
    (projectId: string | null) =>
      sortByUpdatedAtDesc(
        userConversations.filter((conversation) =>
          projectId ? conversation.projectId === projectId : !conversation.projectId
        )
      ),
    [userConversations]
  )

  const activeProject =
    projects.find(
      (project) =>
        project.id === currentConversation?.projectId || project.id === activeScopeProjectId
    ) ?? null

  const projectsClient = useMemo(
    () => createProjectsClient({ authToken: idToken }),
    [idToken]
  )

  useEffect(() => {
    if (!currentConversation) {
      return
    }

    const conversationProjectId = currentConversation.projectId ?? null
    if (currentProjectId !== conversationProjectId) {
      setCurrentProjectId(conversationProjectId)
    }
  }, [currentConversation, currentProjectId, setCurrentProjectId])

  const preserveActiveDeepResearch = useCallback(() => {
    if (
      currentConversation?.id &&
      isDeepResearchStreaming &&
      deepResearchOwnerConversationId === currentConversation.id
    ) {
      persistDeepResearchToSession()
    }
  }, [
    currentConversation?.id,
    deepResearchOwnerConversationId,
    isDeepResearchStreaming,
    persistDeepResearchToSession,
  ])

  const startDraftInContext = useCallback(
    (projectId: string | null, options?: { preserveActive?: boolean }) => {
      if (options?.preserveActive !== false) {
        preserveActiveDeepResearch()
      }
      setCurrentProjectId(projectId)
      startNewSessionDraft()
      updateRouteUrl(projectId, null)
      closeRightPanel()
    },
    [
      closeRightPanel,
      preserveActiveDeepResearch,
      setCurrentProjectId,
      startNewSessionDraft,
      updateRouteUrl,
    ]
  )

  useEffect(() => {
    let cancelled = false
    let polling = false

    const pollBackgroundJobs = async () => {
      if (polling) {
        return
      }
      polling = true

      try {
        const chatStoreApi = useChatStore as typeof useChatStore & {
          getState?: () => ReturnType<typeof useChatStore>
        }

        if (typeof chatStoreApi.getState !== 'function') {
          return
        }

        const { getJobStatus } = await import('@/adapters/api/deep-research-client')
        const chatState = chatStoreApi.getState()
        const conversations = chatState.getUserConversations()

        for (const conversation of conversations) {
          if (cancelled || conversation.id === chatState.currentConversation?.id) {
            continue
          }

          const latestMessage = getLatestDeepResearchMessage(conversation.messages)
          if (!latestMessage?.deepResearchJobId || !latestMessage.deepResearchJobStatus) {
            continue
          }

          const jobId = latestMessage.deepResearchJobId
          const currentJobStatus = latestMessage.deepResearchJobStatus
          if (!['submitted', 'running'].includes(currentJobStatus)) {
            continue
          }

          try {
            const statusResponse = await getJobStatus(jobId, idToken || undefined)
            if (cancelled) {
              return
            }

            if (statusResponse.status === 'submitted' || statusResponse.status === 'running') {
              if (statusResponse.status !== currentJobStatus) {
                patchConversationMessage(conversation.id, latestMessage.id, {
                  deepResearchJobStatus: statusResponse.status,
                })
              }
              continue
            }

            const completedAtMs = statusResponse.updated_at
              ? Date.parse(statusResponse.updated_at)
              : Date.now()
            const durationMs =
              typeof statusResponse.elapsed_seconds === 'number'
                ? Math.round(statusResponse.elapsed_seconds * 1000)
                : latestMessage.deepResearchDurationMs
            const terminalBannerType =
              statusResponse.status === 'success'
                ? 'success'
                : statusResponse.status === 'interrupted'
                  ? 'cancelled'
                  : 'failure'

            patchConversationMessage(conversation.id, latestMessage.id, {
              deepResearchJobStatus: statusResponse.status,
              isDeepResearchActive: false,
              showViewReport: statusResponse.status === 'success',
              deepResearchStartedAtMs: latestMessage.deepResearchStartedAtMs,
              deepResearchCompletedAtMs: completedAtMs,
              deepResearchDurationMs: durationMs,
            })

            const hasTerminalBanner = conversation.messages.some(
              (message) =>
                message.messageType === 'deep_research_banner' &&
                message.deepResearchBannerData?.jobId === jobId &&
                ['success', 'failure', 'cancelled'].includes(
                  message.deepResearchBannerData?.bannerType || ''
                )
            )

            if (!hasTerminalBanner) {
              addDeepResearchBanner(terminalBannerType, jobId, conversation.id, {
                durationMs: durationMs ?? undefined,
              })
            }
          } catch (error) {
            console.warn('Failed to poll background deep research job:', error)
          }
        }
      } finally {
        polling = false
      }
    }

    void pollBackgroundJobs()
    const interval = setInterval(() => {
      void pollBackgroundJobs()
    }, 5000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [idToken, patchConversationMessage, addDeepResearchBanner])

  const handleNewChat = useCallback(() => {
    startDraftInContext(activeScopeProjectId)
  }, [activeScopeProjectId, startDraftInContext])

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      const conversation = userConversations.find((item) => item.id === sessionId)
      if (!conversation) {
        return
      }

      selectConversation(sessionId)
      updateRouteUrl(conversation.projectId ?? null, sessionId)
    },
    [selectConversation, updateRouteUrl, userConversations]
  )

  const handleSelectRoot = useCallback(() => {
    const nextConversation = getScopeConversations(null)[0] ?? null
    if (nextConversation) {
      selectConversation(nextConversation.id)
      updateRouteUrl(null, nextConversation.id)
      return
    }

    startDraftInContext(null)
  }, [getScopeConversations, selectConversation, startDraftInContext, updateRouteUrl])

  const handleSelectProject = useCallback(
    (projectId: string) => {
      const nextConversation = getScopeConversations(projectId)[0] ?? null
      if (nextConversation) {
        selectConversation(nextConversation.id)
        updateRouteUrl(projectId, nextConversation.id)
        return
      }

      startDraftInContext(projectId)
    },
    [getScopeConversations, selectConversation, startDraftInContext, updateRouteUrl]
  )

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
    startDraftInContext(mappedProject.id)
  }, [projectsClient, startDraftInContext, upsertProject])

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

      if (!currentUserId) {
        if (currentProjectId === projectId || currentConversation?.projectId === projectId) {
          startDraftInContext(null, { preserveActive: false })
        }
        return
      }

      const remainingConversations = userConversations.filter(
        (conversation) => conversation.projectId !== projectId
      )
      const isDeletingActiveProject =
        currentProjectId === projectId || currentConversation?.projectId === projectId

      replaceUserConversations(
        currentUserId,
        remainingConversations,
        isDeletingActiveProject ? null : (currentConversation?.id ?? undefined)
      )

      if (isDeletingActiveProject) {
        const nextRootConversation = sortByUpdatedAtDesc(
          remainingConversations.filter((conversation) => !conversation.projectId)
        )[0]

        if (nextRootConversation) {
          selectConversation(nextRootConversation.id)
          updateRouteUrl(null, nextRootConversation.id)
        } else {
          startDraftInContext(null, { preserveActive: false })
        }
        return
      }

      updateRouteUrl(currentConversation?.projectId ?? currentProjectId ?? null, currentConversation?.id ?? null)
    },
    [
      currentConversation?.id,
      currentConversation?.projectId,
      currentProjectId,
      currentUserId,
      projectsClient,
      removeProject,
      replaceUserConversations,
      selectConversation,
      startDraftInContext,
      updateRouteUrl,
      userConversations,
    ]
  )

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      const deletedConversation = userConversations.find((item) => item.id === sessionId) ?? null
      const wasCurrentSession = currentConversation?.id === sessionId
      const deletedProjectId = deletedConversation?.projectId ?? null
      const nextConversation =
        sortByUpdatedAtDesc(
          getScopeConversations(deletedProjectId).filter((conversation) => conversation.id !== sessionId)
        )[0] ?? null

      try {
        await projectsClient.deleteSession(sessionId)
      } catch {
        // Root chats are local-only until explicitly attached to a project.
      }

      deleteConversation(sessionId)

      if (!wasCurrentSession) {
        return
      }

      if (nextConversation) {
        selectConversation(nextConversation.id)
        updateRouteUrl(deletedProjectId, nextConversation.id)
        return
      }

      setCurrentProjectId(deletedProjectId)
      startNewSessionDraft()
      updateRouteUrl(deletedProjectId, null)
      closeRightPanel()
    },
    [
      closeRightPanel,
      currentConversation?.id,
      deleteConversation,
      getScopeConversations,
      projectsClient,
      selectConversation,
      setCurrentProjectId,
      startNewSessionDraft,
      updateRouteUrl,
      userConversations,
    ]
  )

  const handleDeleteAllSessions = useCallback(async () => {
    const projectId = activeScopeProjectId
    const sessionIds = getScopeConversations(projectId).map((conversation) => conversation.id)
    if (sessionIds.length === 0) {
      startDraftInContext(projectId, { preserveActive: false })
      return
    }

    await Promise.allSettled(sessionIds.map((sessionId) => projectsClient.deleteSession(sessionId)))
    sessionIds.forEach((sessionId) => {
      deleteConversation(sessionId)
    })

    setCurrentProjectId(projectId)
    startNewSessionDraft()
    updateRouteUrl(projectId, null)
    closeRightPanel()
  }, [
    activeScopeProjectId,
    closeRightPanel,
    deleteConversation,
    getScopeConversations,
    projectsClient,
    setCurrentProjectId,
    startDraftInContext,
    startNewSessionDraft,
    updateRouteUrl,
  ])

  const isResearchPanelOpen = rightPanel === 'research'
  const isResearchPanelExpanded =
    isResearchPanelOpen &&
    (researchPanelMode === 'full-width' || researchPanelWidthPercent >= 100)
  const isNavigationBlocked = isStreaming || pendingInteraction !== null

  const scopeConversations = getScopeConversations(activeScopeProjectId)
  const sessions = scopeConversations.map((conversation) => ({
    id: conversation.id,
    title: conversation.title,
    date: new Date(conversation.updatedAt),
    hasActiveDeepResearch:
      hasActiveDeepResearchJob(conversation.messages) ||
      (isDeepResearchStreaming && deepResearchOwnerConversationId === conversation.id),
  }))

  const projectItems = projects.map((project) => ({
    id: project.id,
    title: project.title,
    date: new Date(project.updatedAt),
  }))

  return (
    <Flex direction="col" className="h-screen min-w-[768px] overflow-x-auto overflow-y-hidden">
      <AppBar
        projectTitle={activeProject?.title ?? undefined}
        chatTitle={currentConversation?.title ?? 'New Chat'}
        isProjectContext={Boolean(activeProject)}
        isAuthenticated={isAuthenticated}
        authRequired={authRequired}
        user={user}
        onNewChat={handleNewChat}
        isNewChatDisabled={isNavigationBlocked}
        onSignIn={onSignIn}
        onSignOut={onSignOut}
      />

      <div className="relative flex flex-1 overflow-hidden">
        <div
          data-testid="main-layout-chat-pane"
          aria-hidden={isResearchPanelExpanded}
          className="flex flex-col overflow-hidden"
          style={{
            width: isResearchPanelOpen
              ? (isResearchPanelExpanded ? '0%' : `${Math.max(100 - researchPanelWidthPercent, 0)}%`)
              : '100%',
            minWidth: isResearchPanelExpanded ? '0px' : undefined,
            opacity: isResearchPanelExpanded ? 0 : 1,
            pointerEvents: isResearchPanelExpanded ? 'none' : 'auto',
            transition: prefersReducedMotion || isResearchPanelResizing
              ? 'none'
              : 'width 600ms ease-in-out, opacity 180ms ease-in-out',
          }}
        >
          <ChatArea isAuthenticated={isAuthenticated} onSignIn={onSignIn} />
          <NoSourcesBanner isAuthenticated={isAuthenticated} />
          <InputArea isAuthenticated={isAuthenticated} connectionMode="websocket" />
        </div>

        <ResearchPanel isAuthenticated={isAuthenticated} />
      </div>

      <SessionsPanel
        projects={projectItems}
        selectedProjectId={activeScopeProjectId ?? undefined}
        onSelectRoot={handleSelectRoot}
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
        onNewSession={handleNewChat}
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

      <DataSourcesPanel />
      <ProvidersPanel />
      <SettingsPanel />
    </Flex>
  )
}
