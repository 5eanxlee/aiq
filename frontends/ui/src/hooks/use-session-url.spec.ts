// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, test, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSessionUrl } from './use-session-url'

// Mock Next.js navigation hooks
const mockRouter = {
  replace: vi.fn(),
  push: vi.fn(),
}

const mockPathname = '/'
let mockSearchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => mockPathname,
  useSearchParams: () => mockSearchParams,
}))

// Mock chat store
const mockChatStore = {
  currentConversation: null as { id: string; projectId?: string } | null,
  currentUserId: null as string | null,
  selectConversation: vi.fn(),
  getUserConversations: vi.fn((): Array<{ id: string; title: string; projectId?: string }> => []),
}

vi.mock('@/features/chat', () => ({
  useChatStore: () => mockChatStore,
}))

const mockProjectsStore = {
  currentProjectId: null as string | null,
  setCurrentProjectId: vi.fn(),
  projects: [] as Array<{ id: string; title: string }>,
  isHydrated: true,
}

vi.mock('@/features/projects', () => ({
  useProjectsStore: (selector: (state: typeof mockProjectsStore) => unknown) =>
    selector(mockProjectsStore),
}))

describe('useSessionUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearchParams = new URLSearchParams()
    mockChatStore.currentConversation = null
    mockChatStore.currentUserId = null
    mockChatStore.getUserConversations.mockReturnValue([])
    mockProjectsStore.currentProjectId = null
    mockProjectsStore.projects = []
  })

  describe('initialization', () => {
    test('returns updateRouteUrl and clearSessionUrl functions', () => {
      const { result } = renderHook(() => useSessionUrl({ isAuthenticated: false }))

      expect(result.current.updateRouteUrl).toBeInstanceOf(Function)
      expect(result.current.clearSessionUrl).toBeInstanceOf(Function)
    })
  })

  describe('updateRouteUrl', () => {
    test('adds session parameter to URL', () => {
      const { result } = renderHook(() => useSessionUrl({ isAuthenticated: true }))

      act(() => {
        result.current.updateRouteUrl(null, 'session-123')
      })

      expect(mockRouter.replace).toHaveBeenCalledWith('/?session=session-123')
    })

    test('removes session parameter when null', () => {
      mockSearchParams = new URLSearchParams('session=old-session')

      const { result } = renderHook(() => useSessionUrl({ isAuthenticated: true }))

      act(() => {
        result.current.updateRouteUrl(null, null)
      })

      expect(mockRouter.replace).toHaveBeenCalledWith('/')
    })

    test('preserves other query parameters', () => {
      mockSearchParams = new URLSearchParams('other=param')

      const { result } = renderHook(() => useSessionUrl({ isAuthenticated: true }))

      act(() => {
        result.current.updateRouteUrl(null, 'session-123')
      })

      expect(mockRouter.replace).toHaveBeenCalledWith('/?other=param&session=session-123')
    })

    test('adds project and session parameters to URL', () => {
      const { result } = renderHook(() => useSessionUrl({ isAuthenticated: true }))

      act(() => {
        result.current.updateRouteUrl('project-123', 'session-123')
      })

      expect(mockRouter.replace).toHaveBeenCalledWith('/?project=project-123&session=session-123')
    })
  })

  describe('clearSessionUrl', () => {
    test('removes session parameter from URL', () => {
      mockSearchParams = new URLSearchParams('session=old-session')

      const { result } = renderHook(() => useSessionUrl({ isAuthenticated: true }))

      act(() => {
        result.current.clearSessionUrl()
      })

      expect(mockRouter.replace).toHaveBeenCalledWith('/')
    })
  })

  describe('initial URL sync', () => {
    test('selects conversation when session exists in URL', async () => {
      mockSearchParams = new URLSearchParams('project=project-1&session=session-123')
      mockChatStore.currentUserId = 'user-1'
      mockChatStore.getUserConversations.mockReturnValue([
        { id: 'session-123', title: 'Test Session', projectId: 'project-1' },
      ])
      mockProjectsStore.projects = [{ id: 'project-1', title: 'Project 1' }]

      renderHook(() => useSessionUrl({ isAuthenticated: true }))

      expect(mockChatStore.selectConversation).toHaveBeenCalledWith('session-123')
    })

    test('selects project when project exists in URL without a session', async () => {
      mockSearchParams = new URLSearchParams('project=project-1')
      mockChatStore.currentUserId = 'user-1'
      mockProjectsStore.projects = [{ id: 'project-1', title: 'Project 1' }]

      renderHook(() => useSessionUrl({ isAuthenticated: true }))

      expect(mockProjectsStore.setCurrentProjectId).toHaveBeenCalledWith('project-1')
    })

    test('clears invalid session from URL', async () => {
      mockSearchParams = new URLSearchParams('project=project-1&session=invalid-session')
      mockChatStore.currentUserId = 'user-1'
      mockChatStore.getUserConversations.mockReturnValue([
        { id: 'session-123', title: 'Test Session', projectId: 'project-1' },
      ])
      mockProjectsStore.projects = [{ id: 'project-1', title: 'Project 1' }]

      renderHook(() => useSessionUrl({ isAuthenticated: true }))

      expect(mockRouter.replace).toHaveBeenCalledWith('/')
    })

    test('does nothing when not authenticated', async () => {
      mockSearchParams = new URLSearchParams('session=session-123')
      mockChatStore.currentUserId = 'user-1'
      mockChatStore.getUserConversations.mockReturnValue([
        { id: 'session-123', title: 'Test Session' },
      ])

      renderHook(() => useSessionUrl({ isAuthenticated: false }))

      expect(mockChatStore.selectConversation).not.toHaveBeenCalled()
    })

    test('does nothing when no currentUserId', async () => {
      mockSearchParams = new URLSearchParams('session=session-123')
      mockChatStore.currentUserId = null
      mockChatStore.getUserConversations.mockReturnValue([
        { id: 'session-123', title: 'Test Session' },
      ])

      renderHook(() => useSessionUrl({ isAuthenticated: true }))

      expect(mockChatStore.selectConversation).not.toHaveBeenCalled()
    })

    test('does nothing when no session in URL', async () => {
      mockSearchParams = new URLSearchParams()
      mockChatStore.currentUserId = 'user-1'

      renderHook(() => useSessionUrl({ isAuthenticated: true }))

      expect(mockChatStore.selectConversation).not.toHaveBeenCalled()
    })
  })

  describe('URL sync on conversation change', () => {
    test('updates URL when current conversation changes', async () => {
      mockChatStore.currentUserId = 'user-1'
      mockProjectsStore.currentProjectId = 'project-1'
      mockChatStore.currentConversation = { id: 'session-123', projectId: 'project-1' }

      const { rerender } = renderHook(() => useSessionUrl({ isAuthenticated: true }))

      // Trigger initial sync
      rerender()

      // Change conversation
      mockChatStore.currentConversation = { id: 'session-456', projectId: 'project-1' }
      rerender()

      expect(mockRouter.replace).toHaveBeenCalledWith('/?project=project-1&session=session-456')
    })

    test('clears URL when conversation is cleared', async () => {
      mockSearchParams = new URLSearchParams('project=project-1&session=session-123')
      mockChatStore.currentUserId = 'user-1'
      mockProjectsStore.currentProjectId = 'project-1'
      mockChatStore.currentConversation = { id: 'session-123', projectId: 'project-1' }
      mockChatStore.getUserConversations.mockReturnValue([
        { id: 'session-123', title: 'Test Session', projectId: 'project-1' },
      ])
      mockProjectsStore.projects = [{ id: 'project-1', title: 'Project 1' }]

      const { rerender } = renderHook(() => useSessionUrl({ isAuthenticated: true }))

      // Initial sync happens
      rerender()

      // Clear conversation
      mockChatStore.currentConversation = null
      rerender()

      expect(mockRouter.replace).toHaveBeenCalledWith('/?project=project-1')
    })
  })
})
