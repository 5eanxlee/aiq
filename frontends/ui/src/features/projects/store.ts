// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Projects store.
 */

import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { Project, ProjectsState, ProjectsStore } from './types'

const initialState: ProjectsState = {
  projects: [],
  currentProjectId: null,
  isHydrated: false,
  isSyncing: false,
  error: null,
}

const chooseCurrentProjectId = (
  projects: Project[],
  preferredProjectId: string | null
): string | null => {
  if (preferredProjectId === null) {
    return null
  }
  if (preferredProjectId && projects.some((project) => project.id === preferredProjectId)) {
    return preferredProjectId
  }
  return null
}

export const useProjectsStore = create<ProjectsStore>()(
  devtools(
    (set, get) => ({
      ...initialState,

      setProjects: (projects) => {
        set(
          (state) => ({
            projects,
            currentProjectId: chooseCurrentProjectId(projects, state.currentProjectId),
            error: null,
          }),
          false,
          'setProjects'
        )
      },

      upsertProject: (project) => {
        set(
          (state) => {
            const existing = state.projects.some((item) => item.id === project.id)
            const projects = existing
              ? state.projects.map((item) => (item.id === project.id ? project : item))
              : [project, ...state.projects]
            return {
              projects,
              currentProjectId: state.currentProjectId ?? project.id,
            }
          },
          false,
          'upsertProject'
        )
      },

      removeProject: (projectId) => {
        set(
          (state) => {
            const projects = state.projects.filter((project) => project.id !== projectId)
            return {
              projects,
              currentProjectId: chooseCurrentProjectId(projects, state.currentProjectId === projectId ? null : state.currentProjectId),
            }
          },
          false,
          'removeProject'
        )
      },

      setCurrentProjectId: (projectId) =>
        set(
          (state) => (state.currentProjectId === projectId ? state : { currentProjectId: projectId }),
          false,
          'setCurrentProjectId'
        ),

      markHydrated: (hydrated) =>
        set(
          (state) => (state.isHydrated === hydrated ? state : { isHydrated: hydrated }),
          false,
          'markHydrated'
        ),

      setSyncing: (syncing) =>
        set(
          (state) => (state.isSyncing === syncing ? state : { isSyncing: syncing }),
          false,
          'setSyncing'
        ),

      setError: (error) =>
        set((state) => (state.error === error ? state : { error }), false, 'setError'),

      getCurrentProject: () => {
        const { projects, currentProjectId } = get()
        if (!currentProjectId) {
          return null
        }
        return projects.find((project) => project.id === currentProjectId) ?? null
      },
    }),
    { name: 'ProjectsStore' }
  )
)
