// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useProjectsStore } from './store'

describe('useProjectsStore', () => {
  beforeEach(() => {
    useProjectsStore.setState({
      projects: [],
      currentProjectId: null,
      isHydrated: false,
      isSyncing: false,
      error: null,
    })
  })

  test('does not notify subscribers when setting the same current project id', () => {
    useProjectsStore.setState({ currentProjectId: 'project-1' })
    const listener = vi.fn()
    const unsubscribe = useProjectsStore.subscribe(listener)

    useProjectsStore.getState().setCurrentProjectId('project-1')

    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  test('keeps root context when projects are loaded with no preferred project', () => {
    useProjectsStore.setState({ currentProjectId: null })

    useProjectsStore.getState().setProjects([
      {
        id: 'project-1',
        ownerId: 'user-1',
        title: 'Alpha',
        knowledgeCollectionName: 'project_alpha',
        createdAt: new Date('2026-04-08T12:00:00.000Z'),
        updatedAt: new Date('2026-04-08T12:00:00.000Z'),
      },
    ])

    expect(useProjectsStore.getState().currentProjectId).toBeNull()
  })

  test('returns to root context when the active project is removed', () => {
    useProjectsStore.setState({
      currentProjectId: 'project-1',
      projects: [
        {
          id: 'project-1',
          ownerId: 'user-1',
          title: 'Alpha',
          knowledgeCollectionName: 'project_alpha',
          createdAt: new Date('2026-04-08T12:00:00.000Z'),
          updatedAt: new Date('2026-04-08T12:00:00.000Z'),
        },
        {
          id: 'project-2',
          ownerId: 'user-1',
          title: 'Beta',
          knowledgeCollectionName: 'project_beta',
          createdAt: new Date('2026-04-08T12:00:00.000Z'),
          updatedAt: new Date('2026-04-08T12:00:00.000Z'),
        },
      ],
    })

    useProjectsStore.getState().removeProject('project-1')

    expect(useProjectsStore.getState().currentProjectId).toBeNull()
  })
})
