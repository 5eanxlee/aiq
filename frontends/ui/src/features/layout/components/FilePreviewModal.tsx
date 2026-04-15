// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * FilePreviewModal Component
 *
 * Displays file details for an uploaded file and provides
 * a direct download action for the original upload.
 */

'use client'

import { type FC } from 'react'
import { Badge, Banner, Button, Divider, Flex, Modal, ModalCloseButton, Spinner, Text } from '@/adapters/ui'
import { Document, Download } from '@/adapters/ui/icons'
import type { FilePreview } from '@/adapters/api'

interface FilePreviewModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  preview: FilePreview | null
  isLoading?: boolean
  error?: string | null
  downloadError?: string | null
  onDownload?: () => void
  isDownloading?: boolean
  projectTitle?: string | null
}

const formatDateTime = (value?: string | null): string | null => {
  if (!value) {
    return null
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return null
  }

  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const formatFileSize = (bytes?: number | null): string | null => {
  if (!bytes || bytes <= 0) {
    return null
  }

  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / Math.pow(1024, exponent)
  return `${value % 1 === 0 ? value : value.toFixed(1)} ${units[exponent]}`
}

const getMetadataRows = (preview: FilePreview): Array<{ label: string; value: string }> => {
  const rows: Array<{ label: string; value: string | null }> = [
    { label: 'Collection', value: preview.collection_name },
    { label: 'Status', value: preview.status },
    { label: 'Chunks', value: `${preview.chunk_count}` },
    { label: 'Uploaded', value: formatDateTime(preview.uploaded_at) },
    { label: 'Ingested', value: formatDateTime(preview.ingested_at) },
    { label: 'Size', value: formatFileSize(preview.file_size) },
  ]

  const fileType =
    typeof preview.metadata?.file_type === 'string'
      ? preview.metadata.file_type
      : typeof preview.metadata?.document_type === 'string'
        ? preview.metadata.document_type
        : null
  if (fileType) {
    rows.push({ label: 'Type', value: fileType })
  }

  const pageCount = preview.metadata?.page_count
  if (typeof pageCount === 'number' && pageCount > 0) {
    rows.push({ label: 'Pages', value: `${pageCount}` })
  }

  const contentTypes = preview.metadata?.content_types
  if (Array.isArray(contentTypes) && contentTypes.length > 0) {
    rows.push({ label: 'Content', value: contentTypes.join(', ') })
  }

  return rows.filter((row): row is { label: string; value: string } => typeof row.value === 'string')
}

export const FilePreviewModal: FC<FilePreviewModalProps> = ({
  open,
  onOpenChange,
  preview,
  isLoading = false,
  error,
  downloadError,
  onDownload,
  isDownloading = false,
  projectTitle,
}) => {
  const metadataRows = preview ? getMetadataRows(preview) : []
  if (projectTitle) {
    metadataRows.unshift({ label: 'Project', value: projectTitle })
  } else if (preview) {
    metadataRows.unshift({ label: 'Scope', value: 'This chat' })
  }

  const downloadLabel = preview?.file_name?.toLowerCase().endsWith('.pdf') ? 'Download PDF' : 'Download File'
  const canDownload = Boolean(preview && onDownload && !isLoading)
  const memoryBadgeLabel = projectTitle ? 'Project Memory' : 'Chat Only'
  const memoryTitle = projectTitle ?? 'This chat'

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      slotHeading={
        <Flex align="center" gap="2" className="min-w-0">
          <Document width={20} height={20} className="text-secondary" />
          <span className="truncate">{preview?.file_name ?? 'File Preview'}</span>
        </Flex>
      }
      slotFooter={
        <>
          <ModalCloseButton kind="tertiary">Close</ModalCloseButton>
          <Button kind="primary" color="brand" onClick={onDownload} disabled={!canDownload || isDownloading}>
            <Download />
            {isDownloading ? 'Preparing...' : downloadLabel}
          </Button>
        </>
      }
    >
      <Flex direction="col" gap="4" className="max-h-[70vh] overflow-y-auto">
        {isLoading ? (
          <Flex direction="col" align="center" justify="center" gap="3" className="py-12">
            <Spinner size="medium" aria-label="Loading file preview" />
            <Text kind="body/regular/sm" className="text-subtle">
              Loading file details...
            </Text>
          </Flex>
        ) : error ? (
          <Banner kind="inline" status="error">
            {error}
          </Banner>
        ) : preview ? (
          <>
            {downloadError && (
              <Banner kind="inline" status="error">
                {downloadError}
              </Banner>
            )}

            <Flex direction="col" gap="3">
              <Flex align="center" gap="2" className="min-w-0">
                <Badge color="teal">{memoryBadgeLabel}</Badge>
                <Text kind="label/semibold/sm" className="truncate text-primary" title={memoryTitle}>
                  {memoryTitle}
                </Text>
              </Flex>
            </Flex>

            <Divider />

            <Flex direction="col" gap="2">
              <Text kind="label/semibold/sm" className="text-primary">
                File Details
              </Text>
              <Flex direction="col" gap="2">
                {metadataRows.map((row) => (
                  <Flex key={row.label} align="start" justify="between" gap="4">
                    <Text kind="body/regular/xs" className="text-subtle">
                      {row.label}
                    </Text>
                    <Text kind="body/regular/sm" className="text-primary text-right break-words">
                      {row.value}
                    </Text>
                  </Flex>
                ))}
              </Flex>
            </Flex>
          </>
        ) : (
          <Banner kind="inline" status="info">
            Select a file to inspect its details.
          </Banner>
        )}
      </Flex>
    </Modal>
  )
}
