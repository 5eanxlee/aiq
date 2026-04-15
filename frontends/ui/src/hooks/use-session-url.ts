// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * useSessionUrl Hook
 *
 * Syncs the active project/chat selection with the URL query parameters.
 * - On mount, reads ?project=xxx&session=yyy from the URL and restores state
 * - Provides updateRouteUrl to update URL when project or chat changes
 * - Handles invalid/missing project or session IDs gracefully
 */

'use client'

import { useEffect, useCallback, useRef } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { useChatStore } from '@/features/chat'
import { useProjectsStore } from '@/features/projects'

interface UseSessionUrlOptions {
  /** Whether the user is authenticated (session sync only works when authenticated) */
  isAuthenticated: boolean
}

interface UseSessionUrlReturn {
  /** Update URL to reflect the given project/session IDs */
  updateRouteUrl: (projectId: string | null, sessionId?: string | null) => void
  /** Clear session from URL (navigate to root) */
  clearSessionUrl: () => void
}

/**
 * Hook to sync session state with URL query parameters.
 * Enables refreshing to the same chat and shareable chat URLs.
 */
export function useSessionUrl({ isAuthenticated }: UseSessionUrlOptions): UseSessionUrlReturn {
  const router = useRouter()
  const pathname = usePathname() ?? '/'
  const searchParams = useSearchParams()

  const currentUserId = useChatStore((state) => state.currentUserId)
  const currentConversation = useChatStore((state) => state.currentConversation)
  const getUserConversations = useChatStore((state) => state.getUserConversations)
  const selectConversation = useChatStore((state) => state.selectConversation)
  const startNewSessionDraft = useChatStore((state) => state.startNewSessionDraft)

  const projects = useProjectsStore((state) => state.projects)
  const projectsHydrated = useProjectsStore((state) => state.isHydrated)
  const currentProjectId = useProjectsStore((state) => state.currentProjectId)
  const setCurrentProjectId = useProjectsStore((state) => state.setCurrentProjectId)

  const initialSyncDone = useRef(false)

  useEffect(() => {
    if (
      !isAuthenticated ||
      !currentUserId ||
      !searchParams ||
      !projectsHydrated ||
      initialSyncDone.current
    ) {
      return
    }

    const sessionId = searchParams.get('session')
    const projectId = searchParams.get('project')

    if (!sessionId && !projectId) {
      initialSyncDone.current = true
      return
    }

    const userConversations = getUserConversations()
    const session = sessionId
      ? userConversations.find((conversation) => conversation.id === sessionId) ?? null
      : null
    const projectExists = projectId ? projects.some((project) => project.id === projectId) : false

    if (session) {
      if (currentConversation?.id !== session.id) {
        selectConversation(session.id)
      }
      setCurrentProjectId(session.projectId ?? null)
    } else if (projectId && projectExists) {
      setCurrentProjectId(projectId)
      if (currentConversation?.projectId !== projectId || currentConversation?.id) {
        startNewSessionDraft()
      }
    } else {
      const newParams = new URLSearchParams(searchParams.toString())
      newParams.delete('session')
      newParams.delete('project')
      const newUrl = newParams.toString() ? `${pathname}?${newParams.toString()}` : pathname
      router.replace(newUrl)
    }

    initialSyncDone.current = true
  }, [
    isAuthenticated,
    currentUserId,
    searchParams,
    pathname,
    projectsHydrated,
    projects,
    router,
    getUserConversations,
    currentConversation?.id,
    currentConversation?.projectId,
    selectConversation,
    startNewSessionDraft,
    setCurrentProjectId,
  ])

  useEffect(() => {
    if (!isAuthenticated || !currentUserId || !searchParams || !initialSyncDone.current) {
      return
    }

    const urlSessionId = searchParams.get('session')
    const urlProjectId = searchParams.get('project')
    const currentSessionId = currentConversation?.id ?? null
    const effectiveProjectId = currentConversation?.projectId ?? currentProjectId ?? null

    if (currentSessionId !== urlSessionId || effectiveProjectId !== urlProjectId) {
      const newParams = new URLSearchParams(searchParams.toString())
      if (effectiveProjectId) {
        newParams.set('project', effectiveProjectId)
      } else {
        newParams.delete('project')
      }
      if (currentSessionId) {
        newParams.set('session', currentSessionId)
      } else {
        newParams.delete('session')
      }
      const newUrl = newParams.toString() ? `${pathname}?${newParams.toString()}` : pathname
      router.replace(newUrl)
    }
  }, [
    isAuthenticated,
    currentUserId,
    currentConversation?.id,
    currentConversation?.projectId,
    currentProjectId,
    searchParams,
    pathname,
    router,
  ])

  const updateRouteUrl = useCallback(
    (projectId: string | null, sessionId?: string | null) => {
      const currentParams = searchParams?.toString() ?? ''
      const newParams = new URLSearchParams(currentParams)

      if (projectId) {
        newParams.set('project', projectId)
      } else {
        newParams.delete('project')
      }

      if (sessionId) {
        newParams.set('session', sessionId)
      } else {
        newParams.delete('session')
      }

      const newUrl = newParams.toString() ? `${pathname}?${newParams.toString()}` : pathname
      router.replace(newUrl)
    },
    [searchParams, pathname, router]
  )

  const clearSessionUrl = useCallback(() => {
    updateRouteUrl(null, null)
  }, [updateRouteUrl])

  return {
    updateRouteUrl,
    clearSessionUrl,
  }
}
