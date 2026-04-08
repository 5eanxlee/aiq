// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Project feature types.
 */

export interface Project {
  id: string
  ownerId: string
  title: string
  description?: string | null
  knowledgeCollectionName: string
  createdAt: Date
  updatedAt: Date
}

export interface ProjectsState {
  projects: Project[]
  currentProjectId: string | null
  isHydrated: boolean
  isSyncing: boolean
  error: string | null
}

export interface ProjectsActions {
  setProjects: (projects: Project[]) => void
  upsertProject: (project: Project) => void
  removeProject: (projectId: string) => void
  setCurrentProjectId: (projectId: string | null) => void
  markHydrated: (hydrated: boolean) => void
  setSyncing: (syncing: boolean) => void
  setError: (error: string | null) => void
  getCurrentProject: () => Project | null
}

export type ProjectsStore = ProjectsState & ProjectsActions

