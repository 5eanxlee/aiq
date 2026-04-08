// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * FileSourcesTab Component
 *
 * Content for the "File Sources" tab in the DataSourcePanel.
 * Displays a list of uploaded file sources with their status.
 * Integrates with file upload system for real-time progress tracking.
 */

'use client'

import { type FC, useCallback, useMemo, useRef, useState } from 'react'
import { Flex, Text, Button, Banner } from '@/adapters/ui'
import { LoadingSpinner } from '@/adapters/ui/icons'
import { FileSourceCard } from './FileSourceCard'
import { DeleteFileConfirmationModal } from './DeleteFileConfirmationModal'
import { useFileUpload, useDocumentsStore, FileUploadZone, mapToDisplayStatus } from '@/features/documents'
import { cacheResolvedFile, getCachedUploadedFile } from '@/features/documents/file-cache'
import { sessionHasKnownCollection } from '@/features/documents/persistence'
import { useChatStore } from '@/features/chat/store'
import { resolveKnowledgeCollectionName } from '@/features/chat/lib/resolve-knowledge-collection'
import { useLayoutStore } from '../store'
import { useAppConfig } from '@/shared/context'
import { useProjectsStore } from '@/features/projects'
import { useAuth } from '@/adapters/auth'
import { createDocumentsClient, type FilePreview } from '@/adapters/api'
import { FilePreviewModal } from './FilePreviewModal'

interface FileSourcesTabProps {
  /** Callback when a file is deleted */
  onDeleteFile?: (id: string) => void
}

const triggerBrowserDownload = (file: File): void => {
  const downloadUrl = window.URL.createObjectURL(file)
  const anchor = document.createElement('a')
  anchor.href = downloadUrl
  anchor.download = file.name || 'document'
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => window.URL.revokeObjectURL(downloadUrl), 0)
}

/**
 * Tab content showing list of uploaded file sources.
 * Connected to the file upload store for real-time updates.
 */
export const FileSourcesTab: FC<FileSourcesTabProps> = ({ onDeleteFile }) => {
  // Get current conversation and ensureSession for session management
  const currentConversation = useChatStore((state) => state.currentConversation)
  const ensureSession = useChatStore((state) => state.ensureSession)
  const currentProject = useProjectsStore((state) => {
    const targetProjectId = currentConversation
      ? currentConversation.projectId ?? null
      : state.currentProjectId
    if (!targetProjectId) {
      return null
    }
    return state.projects.find((project) => project.id === targetProjectId) ?? null
  })
  const currentCollectionName =
    resolveKnowledgeCollectionName(currentConversation, currentProject?.knowledgeCollectionName)
  const projectTitle = currentProject?.title ?? null
  const isProjectScope = Boolean(projectTitle)
  const emptyStateHeading = isProjectScope ? 'No Project Files' : 'No Chat Files'
  const filesHeading = isProjectScope ? 'Project Files' : 'Chat Files'
  const emptyStateCopy = isProjectScope
    ? `Files uploaded to "${projectTitle}" will be shared across sessions and remain accessible to agents until removed.`
    : 'Files uploaded to this standalone chat stay available only in this chat and are not reused by projects or other chats.'
  const filesScopeCopy = isProjectScope
    ? `Shared across every session in "${projectTitle}".`
    : 'Used only in this standalone chat.'

  // Check if file uploads are available (knowledge layer)
  const knowledgeLayerAvailable = useLayoutStore((state) => state.knowledgeLayerAvailable)

  // Get file upload configuration from app config
  const { fileUpload: fileUploadConfig } = useAppConfig()
  const { idToken } = useAuth()
  const documentsClient = useMemo(() => createDocumentsClient({ authToken: idToken }), [idToken])

  // File upload hook - provides session files and handles validation internally
  const {
    uploadFiles,
    deleteFile,
    sessionFiles,
    isUploading,
    isPolling,
    error: uploadError,
    clearError,
  } = useFileUpload({
    sessionId: currentConversation?.id,
    collectionName: currentCollectionName,
  })

  // The documents store's currentCollectionName tells us WHICH session is actively being processed.
  // isUploading/isPolling are global flags, so we must scope to the current session to avoid
  // showing a spinner for uploads belonging to a different session.
  const activeCollection = useDocumentsStore((state) => state.currentCollectionName)
  const isLoadingFiles = useDocumentsStore((state) => state.isLoadingFiles)
  const loadedSessionId = useDocumentsStore((state) => state.loadedSessionId)
  const isThisSessionProcessing =
    activeCollection === currentCollectionName && (isUploading || isPolling)

  // Show spinner when:
  // 1. Actively loading files from server, OR
  // 2. Upload/polling in progress but files haven't appeared, OR
  // 3. Session is known to have files but we haven't loaded for it yet
  //    (covers the render-to-useEffect gap on session switch; stops once
  //    loadFilesForSession completes — even if the result is empty)
  const sessionId = currentCollectionName
  const hasLoadedForSession = loadedSessionId === sessionId
  const sessionExpectsFiles =
    !!sessionId &&
    !hasLoadedForSession &&
    (sessionHasKnownCollection(sessionId) || sessionId.startsWith('project_'))
  const isAwaitingFiles =
    isLoadingFiles ||
    (isThisSessionProcessing && sessionFiles.length === 0) ||
    sessionExpectsFiles

  // Delete confirmation modal state
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [fileIdToDelete, setFileIdToDelete] = useState<string | null>(null)
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false)
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewFile, setPreviewFile] = useState<FilePreview | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [isDownloadingPreviewFile, setIsDownloadingPreviewFile] = useState(false)

  /**
   * Handle file upload with session auto-creation.
   * Validation is handled internally by uploadFiles.
   */
  const handleUpload = useCallback(
    async (files: File[]) => {
      const ensuredSessionId = ensureSession()
      if (!ensuredSessionId) {
        console.error('Failed to create session for upload')
        return
      }
      const activeConversation = useChatStore.getState().currentConversation
      const activeProjectsState = useProjectsStore.getState()
      const activeProject =
        activeConversation?.projectId
          ? activeProjectsState.projects.find((project) => project.id === activeConversation.projectId)
          : activeProjectsState.getCurrentProject()
      const targetCollectionName = resolveKnowledgeCollectionName(
        activeConversation,
        activeProject?.knowledgeCollectionName
      )
      if (!targetCollectionName) {
        console.error('Failed to resolve collection for upload')
        return
      }
      // uploadFiles validates internally and sets error if invalid
      await uploadFiles(files, targetCollectionName)
    },
    [ensureSession, uploadFiles]
  )

  // Hidden file input ref
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Handle Add File button click
  const handleAddFileClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  // Handle file input change
  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || [])
      if (files.length > 0) {
        handleUpload(files)
      }
      // Reset input so same file can be selected again
      e.target.value = ''
    },
    [handleUpload]
  )

  // Opens the delete confirmation modal
  const handleDeleteClick = useCallback((id: string) => {
    setFileIdToDelete(id)
    setIsDeleteModalOpen(true)
  }, [])

  // Actually performs the delete after confirmation
  const handleConfirmDelete = useCallback(async () => {
    if (fileIdToDelete) {
      await deleteFile(fileIdToDelete)
      onDeleteFile?.(fileIdToDelete)
      setFileIdToDelete(null)
    }
  }, [fileIdToDelete, deleteFile, onDeleteFile])

  // Handles modal close/cancel
  const handleModalOpenChange = useCallback((open: boolean) => {
    setIsDeleteModalOpen(open)
    if (!open) {
      setFileIdToDelete(null)
    }
  }, [])

  const handlePreviewOpenChange = useCallback((open: boolean) => {
    setIsPreviewModalOpen(open)
    if (!open) {
      setPreviewError(null)
      setDownloadError(null)
      setPreviewFile(null)
      setIsPreviewLoading(false)
      setIsDownloadingPreviewFile(false)
    }
  }, [])

  const buildFallbackPreview = useCallback(
    (fileIdentifier: string): FilePreview | null => {
      if (!currentCollectionName) {
        return null
      }

      const fallbackFile = sessionFiles.find(
        (file) =>
          file.serverFileId === fileIdentifier ||
          file.fileName === fileIdentifier ||
          file.id === fileIdentifier
      )

      if (!fallbackFile) {
        return null
      }

      const normalizedStatus = fallbackFile.status === 'deleting' ? 'failed' : fallbackFile.status

      return {
        file_id: fallbackFile.serverFileId ?? fallbackFile.fileName ?? fallbackFile.id,
        file_name: fallbackFile.fileName,
        collection_name: currentCollectionName,
        status: normalizedStatus,
        file_size: fallbackFile.fileSize ?? null,
        chunk_count: 0,
        uploaded_at: fallbackFile.uploadedAt ?? null,
        ingested_at: null,
        metadata: {},
        summary: null,
      }
    },
    [currentCollectionName, sessionFiles]
  )

  const handleViewFile = useCallback(
    async (fileIdentifier: string) => {
      if (!currentCollectionName) {
        return
      }

      setIsPreviewModalOpen(true)
      setPreviewError(null)
      setDownloadError(null)
      setIsPreviewLoading(true)

      try {
        const preview = await documentsClient.getFilePreview(currentCollectionName, fileIdentifier)
        setPreviewFile(preview)
      } catch (error) {
        const fallbackPreview = buildFallbackPreview(fileIdentifier)
        if (fallbackPreview) {
          setPreviewFile(fallbackPreview)
          setPreviewError(null)
        } else {
          setPreviewFile(null)
          setPreviewError(error instanceof Error ? error.message : 'Failed to load file preview')
        }
      } finally {
        setIsPreviewLoading(false)
      }
    },
    [buildFallbackPreview, currentCollectionName, documentsClient]
  )

  const handleDownloadPreviewFile = useCallback(async () => {
    if (!currentCollectionName || !previewFile) {
      return
    }

    setDownloadError(null)
    setIsDownloadingPreviewFile(true)

    try {
      const fileIdentifier = previewFile.file_id || previewFile.file_name
      const { blob, fileName, contentType } = await documentsClient.downloadFile(
        currentCollectionName,
        fileIdentifier
      )
      const resolvedFile = new File([blob], fileName || previewFile.file_name || 'document', {
        type: contentType || blob.type || 'application/octet-stream',
      })
      triggerBrowserDownload(resolvedFile)
      void cacheResolvedFile(currentCollectionName, resolvedFile, previewFile.file_id)
    } catch (error) {
      const localTrackedFile = sessionFiles.find(
        (file) =>
          file.serverFileId === previewFile.file_id ||
          file.fileName === previewFile.file_name ||
          file.id === previewFile.file_id
      )?.file

      const cachedFile =
        localTrackedFile ??
        (await getCachedUploadedFile(currentCollectionName, previewFile.file_id, previewFile.file_name))

      if (cachedFile) {
        triggerBrowserDownload(cachedFile)
        setDownloadError(null)
      } else {
        const message =
          error instanceof Error ? error.message : 'Failed to download file'
        setDownloadError(
          /Original uploaded file is not available for download/i.test(message)
            ? 'This file is not cached locally and the backend does not have the original upload. Re-upload it once to enable downloads.'
            : message
        )
      }
    } finally {
      setIsDownloadingPreviewFile(false)
    }
  }, [currentCollectionName, documentsClient, previewFile, sessionFiles])

  if (sessionFiles.length === 0) {
    // When files are expected (loading, uploading, or session known to have files),
    // always show the spinner — never flash "No Files" during transitions.
    if (isAwaitingFiles) {
      return (
        <Flex direction="col" align="center" justify="center" gap="2" className="flex-1 py-8">
          <LoadingSpinner size="medium" aria-label="Loading files" />
          <Text kind="body/regular/sm" className="text-subtle">
            Checking for files...
          </Text>
        </Flex>
      )
    }

    return (
      <Flex direction="col" gap="4" className="flex-1">
        {/* Show info banner when file upload is not available */}
        {!knowledgeLayerAvailable && (
          <Banner kind="inline" status="info" className="mb-6 px-4 py-3">
            Setup backend to enable files.
          </Banner>
        )}

        {/* Show empty state message when file upload is available */}
        {knowledgeLayerAvailable && (
          <Flex direction="col" gap="1">
            <Text kind="label/semibold/xs" className="text-subtle uppercase">
              {emptyStateHeading}
            </Text>
            <Text kind="body/regular/sm" className="text-subtle">
              {emptyStateCopy}
            </Text>
          </Flex>
        )}

        {/* Upload Error Display */}
        {uploadError && (
          <Banner kind="inline" status="error" onClose={clearError}>
            {uploadError}
          </Banner>
        )}

        {/* File Upload Zone */}
        {knowledgeLayerAvailable && (
          <FileUploadZone
            collectionName={currentCollectionName}
            acceptedTypes={fileUploadConfig.acceptedTypes}
            maxFileSize={fileUploadConfig.maxFileSize}
            onUpload={handleUpload}
            isUploading={isUploading}
          />
        )}
      </Flex>
    )
  }

  return (
    <Flex direction="col" gap="2" className="flex-1 overflow-y-auto">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={fileUploadConfig.acceptedTypes}
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Upload Error Display */}
      {uploadError && (
        <Banner kind="inline" status="error" onClose={clearError}>
          {uploadError}
        </Banner>
      )}

      {/* Header with count and add button */}
      <Flex align="center" justify="between" className="mb-1">
        <Flex direction="col" gap="1">
          <Text kind="label/semibold/xs" className="text-subtle uppercase">
            {filesHeading} ({sessionFiles.length})
          </Text>
          <Text kind="body/regular/xs" className="text-subtle">
            {filesScopeCopy}
          </Text>
        </Flex>
        <Button
          kind="tertiary"
          size="small"
          onClick={handleAddFileClick}
          disabled={isLoadingFiles || !knowledgeLayerAvailable}
          title={isLoadingFiles ? "Loading files..." : knowledgeLayerAvailable ? "Add files" : "File upload not available"}
        >
          + Add File
        </Button>
      </Flex>

      {/* File list */}
      {sessionFiles.map((file) => (
        <FileSourceCard
          key={file.id}
          id={file.id}
          title={file.fileName}
          fileSize={file.fileSize}
          uploadedAt={file.uploadedAt}
          status={mapToDisplayStatus(file.status)}
          errorMessage={file.errorMessage ?? undefined}
          expirationIntervalHours={fileUploadConfig.fileExpirationCheckIntervalHours}
          onView={() => handleViewFile(file.serverFileId ?? file.fileName)}
          viewDisabled={file.status === 'uploading' || file.status === 'ingesting' || file.status === 'deleting'}
          onDelete={handleDeleteClick}
        />
      ))}

      {/* Delete Confirmation Modal */}
      <DeleteFileConfirmationModal
        open={isDeleteModalOpen}
        onOpenChange={handleModalOpenChange}
        onConfirm={handleConfirmDelete}
      />

      <FilePreviewModal
        open={isPreviewModalOpen}
        onOpenChange={handlePreviewOpenChange}
        preview={previewFile}
        isLoading={isPreviewLoading}
        error={previewError}
        downloadError={downloadError}
        onDownload={handleDownloadPreviewFile}
        isDownloading={isDownloadingPreviewFile}
        projectTitle={projectTitle}
      />
    </Flex>
  )
}
