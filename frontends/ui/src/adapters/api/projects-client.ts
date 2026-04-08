// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Projects/session API client.
 */

import { apiConfig } from './config'
import {
  ProjectArtifactFromAPISchema,
  ProjectFromAPISchema,
  SessionFromAPISchema,
  SessionSnapshotFromAPISchema,
  type ProjectArtifactFromAPI,
  type ProjectFromAPI,
  type SessionFromAPI,
  type SessionSnapshotFromAPI,
} from './projects-schemas'

const getApiBaseUrl = (): string => {
  const isBrowser = typeof window !== 'undefined'
  return isBrowser ? '/api/v1' : apiConfig.baseUrl + '/v1'
}

async function handleApiError(response: Response, context: string): Promise<never> {
  const error = await response.json().catch(() => ({}))
  throw new Error(error?.detail || error?.error?.message || `${context}: ${response.statusText}`)
}

export interface ProjectsClientOptions {
  authToken?: string
}

export interface CreateProjectPayload {
  id?: string
  title: string
  description?: string | null
  knowledge_collection_name?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export interface UpdateProjectPayload {
  title?: string
  description?: string | null
}

export interface CreateSessionPayload {
  id?: string
  title: string
  knowledge_collection_name_override?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export interface UpdateSessionPayload {
  title?: string
  knowledge_collection_name_override?: string | null
}

export interface PutSessionSnapshotPayload {
  messages: Array<Record<string, unknown>>
  enabled_data_source_ids?: string[]
  updated_at?: string | null
}

export interface CreateProjectArtifactPayload {
  session_id?: string | null
  kind: string
  title: string
  body_markdown: string
  citation_manifest?: Array<Record<string, unknown>>
  artifact_id?: string
  created_at?: string | null
  promote_to_knowledge?: boolean
}

export interface ProjectsClient {
  listProjects: () => Promise<ProjectFromAPI[]>
  createProject: (payload: CreateProjectPayload) => Promise<ProjectFromAPI>
  updateProject: (projectId: string, payload: UpdateProjectPayload) => Promise<ProjectFromAPI>
  deleteProject: (projectId: string) => Promise<void>
  createSession: (projectId: string, payload: CreateSessionPayload) => Promise<SessionFromAPI>
  getSession: (sessionId: string) => Promise<SessionFromAPI>
  updateSession: (sessionId: string, payload: UpdateSessionPayload) => Promise<SessionFromAPI>
  deleteSession: (sessionId: string) => Promise<void>
  getSessionSnapshot: (sessionId: string) => Promise<SessionSnapshotFromAPI>
  putSessionSnapshot: (
    sessionId: string,
    payload: PutSessionSnapshotPayload
  ) => Promise<SessionSnapshotFromAPI>
  listArtifacts: (projectId: string) => Promise<ProjectArtifactFromAPI[]>
  createArtifact: (
    projectId: string,
    payload: CreateProjectArtifactPayload
  ) => Promise<ProjectArtifactFromAPI>
}

export const createProjectsClient = (options: ProjectsClientOptions = {}): ProjectsClient => {
  const { authToken } = options

  const getHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`
    }
    return headers
  }

  return {
    async listProjects(): Promise<ProjectFromAPI[]> {
      const response = await fetch(`${getApiBaseUrl()}/projects`, {
        method: 'GET',
        headers: getHeaders(),
      })

      if (!response.ok) {
        await handleApiError(response, 'Failed to list projects')
      }

      const data = await response.json()
      return ProjectFromAPISchema.array().parse(data)
    },

    async createProject(payload: CreateProjectPayload): Promise<ProjectFromAPI> {
      const response = await fetch(`${getApiBaseUrl()}/projects`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        await handleApiError(response, 'Failed to create project')
      }

      return ProjectFromAPISchema.parse(await response.json())
    },

    async updateProject(projectId: string, payload: UpdateProjectPayload): Promise<ProjectFromAPI> {
      const response = await fetch(`${getApiBaseUrl()}/projects/${projectId}`, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        await handleApiError(response, 'Failed to update project')
      }

      return ProjectFromAPISchema.parse(await response.json())
    },

    async deleteProject(projectId: string): Promise<void> {
      const response = await fetch(`${getApiBaseUrl()}/projects/${projectId}`, {
        method: 'DELETE',
        headers: getHeaders(),
      })

      if (!response.ok) {
        await handleApiError(response, 'Failed to delete project')
      }
    },

    async createSession(projectId: string, payload: CreateSessionPayload): Promise<SessionFromAPI> {
      const response = await fetch(`${getApiBaseUrl()}/projects/${projectId}/sessions`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        await handleApiError(response, 'Failed to create session')
      }

      return SessionFromAPISchema.parse(await response.json())
    },

    async getSession(sessionId: string): Promise<SessionFromAPI> {
      const response = await fetch(`${getApiBaseUrl()}/sessions/${sessionId}`, {
        method: 'GET',
        headers: getHeaders(),
      })

      if (!response.ok) {
        await handleApiError(response, 'Failed to load session')
      }

      return SessionFromAPISchema.parse(await response.json())
    },

    async updateSession(sessionId: string, payload: UpdateSessionPayload): Promise<SessionFromAPI> {
      const response = await fetch(`${getApiBaseUrl()}/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        await handleApiError(response, 'Failed to update session')
      }

      return SessionFromAPISchema.parse(await response.json())
    },

    async deleteSession(sessionId: string): Promise<void> {
      const response = await fetch(`${getApiBaseUrl()}/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: getHeaders(),
      })

      if (!response.ok) {
        await handleApiError(response, 'Failed to delete session')
      }
    },

    async getSessionSnapshot(sessionId: string): Promise<SessionSnapshotFromAPI> {
      const response = await fetch(`${getApiBaseUrl()}/sessions/${sessionId}/snapshot`, {
        method: 'GET',
        headers: getHeaders(),
      })

      if (!response.ok) {
        await handleApiError(response, 'Failed to load session snapshot')
      }

      return SessionSnapshotFromAPISchema.parse(await response.json())
    },

    async putSessionSnapshot(
      sessionId: string,
      payload: PutSessionSnapshotPayload
    ): Promise<SessionSnapshotFromAPI> {
      const response = await fetch(`${getApiBaseUrl()}/sessions/${sessionId}/snapshot`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        await handleApiError(response, 'Failed to persist session snapshot')
      }

      return SessionSnapshotFromAPISchema.parse(await response.json())
    },

    async listArtifacts(projectId: string): Promise<ProjectArtifactFromAPI[]> {
      const response = await fetch(`${getApiBaseUrl()}/projects/${projectId}/artifacts`, {
        method: 'GET',
        headers: getHeaders(),
      })

      if (!response.ok) {
        await handleApiError(response, 'Failed to list project artifacts')
      }

      return ProjectArtifactFromAPISchema.array().parse(await response.json())
    },

    async createArtifact(
      projectId: string,
      payload: CreateProjectArtifactPayload
    ): Promise<ProjectArtifactFromAPI> {
      const response = await fetch(`${getApiBaseUrl()}/projects/${projectId}/artifacts`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        await handleApiError(response, 'Failed to create project artifact')
      }

      return ProjectArtifactFromAPISchema.parse(await response.json())
    },
  }
}

export type {
  ProjectFromAPI,
  SessionFromAPI,
  SessionSnapshotFromAPI,
  ProjectArtifactFromAPI,
}

