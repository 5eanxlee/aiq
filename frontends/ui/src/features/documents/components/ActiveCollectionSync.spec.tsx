// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { render, waitFor } from '@/test-utils'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { ActiveCollectionSync } from './ActiveCollectionSync'

const orchestratorMocks = vi.hoisted(() => ({
  handleSessionChange: vi.fn().mockResolvedValue(undefined),
  loadFilesForSession: vi.fn().mockResolvedValue(undefined),
}))

let mockConversation: {
  id: string
  projectId?: string
  knowledgeCollectionName?: string
  knowledgeCollectionNameOverride?: string | null
} | null = null

let mockProjectsState: {
  currentProjectId: string | null
  projects: Array<{
    id: string
    title: string
    knowledgeCollectionName: string
  }>
} = {
  currentProjectId: 'p_1',
  projects: [
    {
      id: 'p_1',
      title: 'Project Atlas',
      knowledgeCollectionName: 'project_p_1',
    },
  ],
}

let mockLayoutState = {
  knowledgeLayerAvailable: false,
}

vi.mock('@/features/chat/store', () => ({
  useChatStore: vi.fn((selector: (state: { currentConversation: typeof mockConversation }) => unknown) =>
    selector({ currentConversation: mockConversation })
  ),
}))

vi.mock('@/features/projects', () => ({
  useProjectsStore: vi.fn(
    (
      selector: (state: {
        currentProjectId: typeof mockProjectsState.currentProjectId
        projects: typeof mockProjectsState.projects
      }) => unknown
    ) =>
      selector({
        currentProjectId: mockProjectsState.currentProjectId,
        projects: mockProjectsState.projects,
      })
  ),
}))

vi.mock('@/features/layout/store', () => ({
  useLayoutStore: vi.fn(
    (selector: (state: typeof mockLayoutState) => unknown) => selector(mockLayoutState)
  ),
}))

vi.mock('../orchestrator', () => ({
  UploadOrchestrator: {
    handleSessionChange: orchestratorMocks.handleSessionChange,
    loadFilesForSession: orchestratorMocks.loadFilesForSession,
  },
}))

describe('ActiveCollectionSync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConversation = null
    mockProjectsState = {
      currentProjectId: 'p_1',
      projects: [
        {
          id: 'p_1',
          title: 'Project Atlas',
          knowledgeCollectionName: 'project_p_1',
        },
      ],
    }
    mockLayoutState = {
      knowledgeLayerAvailable: false,
    }
  })

  test('syncs the active project collection for draft sessions', async () => {
    render(<ActiveCollectionSync />)

    await waitFor(() => {
      expect(orchestratorMocks.handleSessionChange).toHaveBeenCalledWith('project_p_1')
    })
  })

  test('reloads files when the knowledge layer becomes available after mount', async () => {
    const { rerender } = render(<ActiveCollectionSync />)

    await waitFor(() => {
      expect(orchestratorMocks.handleSessionChange).toHaveBeenCalledWith('project_p_1')
    })

    orchestratorMocks.handleSessionChange.mockClear()
    orchestratorMocks.loadFilesForSession.mockClear()
    mockLayoutState = {
      knowledgeLayerAvailable: true,
    }

    rerender(<ActiveCollectionSync />)

    await waitFor(() => {
      expect(orchestratorMocks.loadFilesForSession).toHaveBeenCalledWith('project_p_1')
    })
  })

  test('prefers a session-specific collection override when present', async () => {
    mockConversation = {
      id: 's_123',
      projectId: 'p_1',
      knowledgeCollectionName: 'project_p_1',
      knowledgeCollectionNameOverride: 'legacy_session_collection',
    }

    render(<ActiveCollectionSync />)

    await waitFor(() => {
      expect(orchestratorMocks.handleSessionChange).toHaveBeenCalledWith('legacy_session_collection')
    })
  })
})
