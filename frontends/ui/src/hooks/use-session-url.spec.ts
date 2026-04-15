// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useSessionUrl } from './use-session-url'

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

const mockChatStore = {
  currentConversation: null as { id: string; projectId?: string | null } | null,
  currentUserId: null as string | null,
  selectConversation: vi.fn(),
  getUserConversations: vi.fn(
    (): Array<{ id: string; title: string; projectId?: string | null }> => []
  ),
  startNewSessionDraft: vi.fn(),
}

vi.mock('@/features/chat', () => ({
  useChatStore: (selector?: (state: typeof mockChatStore) => unknown) =>
    selector ? selector(mockChatStore) : mockChatStore,
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

  test('updates the URL with project and session ids', () => {
    const { result } = renderHook(() => useSessionUrl({ isAuthenticated: true }))

    act(() => {
      result.current.updateRouteUrl('project-123', 'session-456')
    })

    expect(mockRouter.replace).toHaveBeenCalledWith('/?project=project-123&session=session-456')
  })

  test('clears the URL when requested', () => {
    mockSearchParams = new URLSearchParams('project=project-1&session=session-1')

    const { result } = renderHook(() => useSessionUrl({ isAuthenticated: true }))

    act(() => {
      result.current.clearSessionUrl()
    })

    expect(mockRouter.replace).toHaveBeenCalledWith('/')
  })

  test('restores a chat from the URL when both ids are valid', () => {
    mockSearchParams = new URLSearchParams('project=project-1&session=session-123')
    mockChatStore.currentUserId = 'user-1'
    mockChatStore.getUserConversations.mockReturnValue([
      { id: 'session-123', title: 'Synced Chat', projectId: 'project-1' },
    ])
    mockProjectsStore.projects = [{ id: 'project-1', title: 'Project 1' }]

    renderHook(() => useSessionUrl({ isAuthenticated: true }))

    expect(mockChatStore.selectConversation).toHaveBeenCalledWith('session-123')
    expect(mockProjectsStore.setCurrentProjectId).toHaveBeenCalledWith('project-1')
  })

  test('restores project context and starts a draft when only the project id is present', () => {
    mockSearchParams = new URLSearchParams('project=project-1')
    mockChatStore.currentUserId = 'user-1'
    mockProjectsStore.projects = [{ id: 'project-1', title: 'Project 1' }]

    renderHook(() => useSessionUrl({ isAuthenticated: true }))

    expect(mockProjectsStore.setCurrentProjectId).toHaveBeenCalledWith('project-1')
    expect(mockChatStore.startNewSessionDraft).toHaveBeenCalledOnce()
  })

  test('removes invalid project or session params from the URL', () => {
    mockSearchParams = new URLSearchParams('project=missing&session=missing')
    mockChatStore.currentUserId = 'user-1'
    mockProjectsStore.projects = [{ id: 'project-1', title: 'Project 1' }]

    renderHook(() => useSessionUrl({ isAuthenticated: true }))

    expect(mockRouter.replace).toHaveBeenCalledWith('/')
  })

  test('syncs current state back into the URL after initialization', () => {
    mockChatStore.currentUserId = 'user-1'
    mockChatStore.currentConversation = { id: 'session-789', projectId: 'project-1' }
    mockProjectsStore.currentProjectId = 'project-1'

    renderHook(() => useSessionUrl({ isAuthenticated: true }))

    expect(mockRouter.replace).toHaveBeenCalledWith('/?project=project-1&session=session-789')
  })
})
