// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { render, screen } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { FilePreviewModal } from './FilePreviewModal'

const preview = {
  file_id: 'file-1',
  file_name: 'report.pdf',
  collection_name: 'project_workspace_1',
  status: 'success' as const,
  file_size: 1024,
  chunk_count: 4,
  uploaded_at: '2026-04-07T20:00:00.000Z',
  ingested_at: '2026-04-07T20:02:00.000Z',
  metadata: {},
  summary: 'This summary should not be rendered.',
}

describe('FilePreviewModal', () => {
  test('renders file details and download action without the summary section', () => {
    render(
      <FilePreviewModal
        open={true}
        onOpenChange={vi.fn()}
        preview={preview}
        projectTitle="Alpha Project"
        onDownload={vi.fn()}
      />
    )

    expect(screen.getByText('report.pdf')).toBeInTheDocument()
    expect(screen.getByText('File Details')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /download pdf/i })).toBeInTheDocument()
    expect(screen.queryByText('Preview Summary')).not.toBeInTheDocument()
    expect(screen.queryByText('This summary should not be rendered.')).not.toBeInTheDocument()
  })

  test('calls onDownload when the download button is clicked', async () => {
    const user = userEvent.setup()
    const onDownload = vi.fn()

    render(
      <FilePreviewModal
        open={true}
        onOpenChange={vi.fn()}
        preview={preview}
        projectTitle="Alpha Project"
        onDownload={onDownload}
      />
    )

    await user.click(screen.getByRole('button', { name: /download pdf/i }))

    expect(onDownload).toHaveBeenCalledOnce()
  })
})
