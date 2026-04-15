// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * ExportFooter Component
 *
 * Footer with export actions for reports.
 * Provides buttons to export content as Markdown or PDF.
 */

'use client'

import { type FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Banner, Flex, Button } from '@/adapters/ui'
import { useChatStore, useIsCurrentSessionBusy } from '@/features/chat'
import { formatReportMarkdownWithCitations } from '@/features/chat/lib/citation-formatting'
import { downloadAsMarkdown } from '@/utils/download-as-markdown'
import { useDownloadPdfRoute } from '@/hooks/use-download-pdf'
import { Copy, Download } from '@/adapters/ui/icons'

interface ExportFooterProps {
  /** Whether to disable export buttons (e.g., when no content) */
  disabled?: boolean
}

/**
 * Export footer with Markdown and PDF export buttons.
 * Only renders when there's content to export.
 */
export const ExportFooter: FC<ExportFooterProps> = ({ disabled }) => {
  const reportContent = useChatStore((state) => state.reportContent)
  const reportContentCategory = useChatStore((state) => state.reportContentCategory)
  const deepResearchCitations = useChatStore((state) => state.deepResearchCitations)
  const conversationTitle = useChatStore((state) => state.currentConversation?.title)
  const { downloadPdf, isLoading: isPdfLoading, error: pdfError, clearError: clearPdfError } = useDownloadPdfRoute()
  const [mdError, setMdError] = useState<string | null>(null)
  const [copyError, setCopyError] = useState<string | null>(null)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle')
  const copyResetTimeoutRef = useRef<number | null>(null)

  // Defensive check: ensure reportContent is a string before calling trim()
  const reportContentStr = typeof reportContent === 'string' ? reportContent : ''
  const exportContent = useMemo(
    () =>
      reportContentCategory === 'research_notes'
        ? reportContentStr
        : formatReportMarkdownWithCitations(reportContentStr, deepResearchCitations),
    [deepResearchCitations, reportContentCategory, reportContentStr]
  )
  const hasContent = exportContent.trim().length > 0
  const copyActionLabel = reportContentCategory === 'research_notes' ? 'Copy Notes' : 'Copy Memo'

  // Uses centralized hook that checks BOTH ephemeral AND persisted state.
  // This survives page refresh: even if SSE ephemeral flags are lost,
  // the hook derives busy state from persisted message history.
  const isDeepResearchInProgress = useIsCurrentSessionBusy()

  const isExportDisabled = disabled || !hasContent || isDeepResearchInProgress

  const tooltipContent = isDeepResearchInProgress
    ? 'Export will be available when research is complete'
    : hasContent
      ? 'Export report'
      : 'No content to export'

  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current !== null) {
        window.clearTimeout(copyResetTimeoutRef.current)
        copyResetTimeoutRef.current = null
      }
    }
  }, [])

  const handleExportMarkdown = useCallback(() => {
    if (isExportDisabled) return
    setMdError(null)
    const result = downloadAsMarkdown(exportContent, conversationTitle ?? undefined)
    if (!result.success && result.error) {
      setMdError(result.error)
    }
  }, [conversationTitle, exportContent, isExportDisabled])

  const handleExportPDF = useCallback(() => {
    if (isExportDisabled || isPdfLoading) return
    downloadPdf(exportContent, conversationTitle ?? undefined)
  }, [conversationTitle, downloadPdf, exportContent, isExportDisabled, isPdfLoading])

  const handleCopyMemo = useCallback(async () => {
    if (isExportDisabled) return

    setCopyError(null)
    try {
      if (!navigator?.clipboard?.writeText) {
        throw new Error('Clipboard access is unavailable in this browser.')
      }

      await navigator.clipboard.writeText(exportContent)
      setCopyStatus('copied')
      if (copyResetTimeoutRef.current !== null) {
        window.clearTimeout(copyResetTimeoutRef.current)
      }
      copyResetTimeoutRef.current = window.setTimeout(() => {
        setCopyStatus('idle')
        copyResetTimeoutRef.current = null
      }, 2000)
    } catch (error) {
      setCopyStatus('idle')
      setCopyError(error instanceof Error ? error.message : 'Failed to copy memo to clipboard.')
    }
  }, [exportContent, isExportDisabled])

  const exportError = mdError || pdfError || copyError
  const clearExportError = useCallback(() => {
    setMdError(null)
    setCopyError(null)
    clearPdfError()
  }, [clearPdfError])

  return (
    <Flex direction="col" className="border-base shrink-0 border-t">
      {exportError && (
        <Banner kind="inline" status="error" onClose={clearExportError} className="mx-4 mt-3">
          {exportError}
        </Banner>
      )}
      <Flex align="center" justify="end" gap="2" className="px-4 py-3">
        <Button
          kind="tertiary"
          size="small"
          onClick={handleExportMarkdown}
          disabled={isExportDisabled}
          aria-label={isExportDisabled ? `Export as Markdown (${tooltipContent})` : 'Export as Markdown'}
          title={tooltipContent}
        >
          <Download />
          Markdown
        </Button>
        <Button
          kind="primary"
          color="brand"
          size="small"
          onClick={handleExportPDF}
          disabled={isExportDisabled || isPdfLoading}
          aria-label={
            isPdfLoading
              ? 'Generating PDF...'
              : isExportDisabled
                ? `Export as PDF (${tooltipContent})`
                : 'Export as PDF'
          }
          title={isPdfLoading ? 'Generating PDF...' : tooltipContent}
        >
          <Download />
          {isPdfLoading ? 'Generating...' : 'PDF'}
        </Button>
        <Button
          kind="tertiary"
          size="small"
          onClick={() => void handleCopyMemo()}
          disabled={isExportDisabled}
          aria-label={
            isExportDisabled
              ? `${copyActionLabel} (${tooltipContent})`
              : copyStatus === 'copied'
                ? 'Memo copied to clipboard'
                : `${copyActionLabel} to clipboard`
          }
          title={
            isExportDisabled
              ? tooltipContent
              : copyStatus === 'copied'
                ? 'Memo copied to clipboard'
                : 'Copy the entire memo to your clipboard'
          }
        >
          <Copy />
          {copyStatus === 'copied' ? 'Copied' : copyActionLabel}
        </Button>
      </Flex>
    </Flex>
  )
}
