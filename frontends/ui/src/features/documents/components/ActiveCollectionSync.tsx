// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useEffect, useRef } from 'react'
import { useChatStore } from '@/features/chat/store'
import { resolveKnowledgeCollectionName } from '@/features/chat/lib/resolve-knowledge-collection'
import { useLayoutStore } from '@/features/layout/store'
import { useProjectsStore } from '@/features/projects'
import { UploadOrchestrator } from '../orchestrator'

/**
 * Keeps the documents store aligned with the active project/session collection
 * even when the Files tab has never been opened.
 */
export const ActiveCollectionSync = (): null => {
  const currentConversation = useChatStore((state) => state.currentConversation)
  const currentProject = useProjectsStore((state) => {
    const targetProjectId = currentConversation
      ? currentConversation.projectId ?? null
      : state.currentProjectId
    if (!targetProjectId) {
      return null
    }
    return state.projects.find((project) => project.id === targetProjectId) ?? null
  })
  const knowledgeLayerAvailable = useLayoutStore((state) => state.knowledgeLayerAvailable)
  const previousKnowledgeLayerAvailableRef = useRef(knowledgeLayerAvailable)

  const currentCollectionName = resolveKnowledgeCollectionName(
    currentConversation,
    currentProject?.knowledgeCollectionName
  )

  useEffect(() => {
    void UploadOrchestrator.handleSessionChange(currentCollectionName)
  }, [currentCollectionName])

  useEffect(() => {
    const becameAvailable =
      knowledgeLayerAvailable && !previousKnowledgeLayerAvailableRef.current
    previousKnowledgeLayerAvailableRef.current = knowledgeLayerAvailable

    if (becameAvailable && currentCollectionName) {
      void UploadOrchestrator.loadFilesForSession(currentCollectionName)
    }
  }, [currentCollectionName, knowledgeLayerAvailable])

  return null
}
