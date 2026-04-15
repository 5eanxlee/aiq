// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest'
import { FileSourcesTab } from './FileSourcesTab'

const PROJECT_COLLECTION = 'project_workspace_1'
const PROJECT_ID = 'project-1'
const originalCreateObjectURL = URL.createObjectURL
const originalRevokeObjectURL = URL.revokeObjectURL
const mockGetCachedUploadedFile = vi.fn()
const mockCacheResolvedFile = vi.fn()
const mockEnsureSession = vi.fn(() => 'session-1')
let mockCurrentConversation: {
  id: string
  projectId?: string
  knowledgeCollectionName?: string
} | null = {
  id: 'session-1',
  projectId: PROJECT_ID,
  knowledgeCollectionName: PROJECT_COLLECTION,
}
const mockProjectsState: {
  currentProjectId: string | null
  projects: Array<{
    id: string
    title: string
    knowledgeCollectionName: string
  }>
  getCurrentProject: () => {
    id: string
    title: string
    knowledgeCollectionName: string
  } | undefined
} = {
  currentProjectId: PROJECT_ID,
  projects: [
    {
      id: PROJECT_ID,
      title: 'Alpha Project',
      knowledgeCollectionName: PROJECT_COLLECTION,
    },
  ],
  getCurrentProject: () =>
    mockProjectsState.currentProjectId
      ? mockProjectsState.projects.find((project) => project.id === mockProjectsState.currentProjectId)
      : undefined,
}

// Mock the chat store
vi.mock('@/features/chat/store', () => {
  const useChatStore = Object.assign(
    vi.fn((selector) =>
      selector({
        currentConversation: mockCurrentConversation,
        ensureSession: mockEnsureSession,
      })
    ),
    {
      getState: () => ({
        currentConversation: mockCurrentConversation,
        ensureSession: mockEnsureSession,
      }),
    }
  )
  return { useChatStore }
})

vi.mock('@/features/projects', () => {
  const useProjectsStore = Object.assign(vi.fn((selector) => selector(mockProjectsState)), {
    getState: () => mockProjectsState,
  })
  return { useProjectsStore }
})

vi.mock('@/adapters/auth', () => ({
  useAuth: () => ({
    idToken: 'test-token',
  }),
}))

const mockGetFilePreview = vi.fn()
const mockDownloadFile = vi.fn()
vi.mock('@/adapters/api', () => ({
  createDocumentsClient: vi.fn(() => ({
    getFilePreview: mockGetFilePreview,
    downloadFile: mockDownloadFile,
  })),
}))

vi.mock('@/features/documents/file-cache', () => ({
  getCachedUploadedFile: (...args: unknown[]) => mockGetCachedUploadedFile(...args),
  cacheResolvedFile: (...args: unknown[]) => mockCacheResolvedFile(...args),
}))

// Mock useAppConfig
vi.mock('@/shared/context', () => ({
  useAppConfig: () => ({
    authRequired: true,
    fileUpload: {
      acceptedTypes: '.pdf,.docx,.txt,.md',
      acceptedMimeTypes: ['application/pdf', 'text/plain', 'text/markdown'],
      maxTotalSizeMB: 100,
      maxFileSize: 100 * 1024 * 1024,
      maxTotalSize: 100 * 1024 * 1024,
      maxFileCount: 10,
    },
  }),
}))


// Mock the file upload hook
const mockUploadFiles = vi.fn()
const mockDeleteFile = vi.fn()
const mockClearError = vi.fn()

vi.mock('@/features/documents', () => ({
  useFileUpload: vi.fn(() => ({
    uploadFiles: mockUploadFiles,
    deleteFile: mockDeleteFile,
    sessionFiles: [],
    isUploading: false,
    isPolling: false,
    error: null,
    clearError: mockClearError,
  })),
  useDocumentsStore: vi.fn((selector) => {
    const state = {
      currentCollectionName: PROJECT_COLLECTION,
      isLoadingFiles: false,
      loadedSessionId: PROJECT_COLLECTION,
    }
    return selector(state)
  }),
  FileUploadZone: ({ onUpload }: { onUpload: (files: File[]) => void }) => (
    <button onClick={() => onUpload([new File([''], 'test.pdf')])}>Upload Zone</button>
  ),
  mapToDisplayStatus: (status: string) => status,
}))

// Mock the layout store
vi.mock('../store', () => ({
  useLayoutStore: vi.fn((selector) => {
    const state = {
      knowledgeLayerAvailable: true,
    }
    return selector(state)
  }),
}))

// Mock child components
vi.mock('./FileSourceCard', () => ({
  FileSourceCard: ({
    title,
    onDelete,
    onView,
    id,
  }: {
    title: string
    onDelete: (id: string) => void
    onView?: () => void
    id: string
  }) => (
    <div data-testid={`file-card-${id}`}>
      {title}
      <button onClick={onView}>View</button>
      <button onClick={() => onDelete(id)}>Delete</button>
    </div>
  ),
}))

vi.mock('./DeleteFileConfirmationModal', () => ({
  DeleteFileConfirmationModal: ({
    open,
    onConfirm,
    onOpenChange,
  }: {
    open: boolean
    onConfirm: () => void
    onOpenChange: (open: boolean) => void
  }) =>
    open ? (
      <div data-testid="delete-modal">
        <button onClick={onConfirm}>Confirm Delete</button>
        <button onClick={() => onOpenChange(false)}>Cancel</button>
      </div>
    ) : null,
}))

vi.mock('./FilePreviewModal', () => ({
  FilePreviewModal: ({
    open,
    preview,
    error,
    isLoading,
    downloadError,
    onDownload,
    isDownloading,
  }: {
    open: boolean
    preview: { file_name?: string } | null
    error?: string | null
    isLoading?: boolean
    downloadError?: string | null
    onDownload?: () => void
    isDownloading?: boolean
  }) =>
    open ? (
      <div data-testid="file-preview-modal">
        {isLoading ? 'Loading preview' : error ? error : preview?.file_name}
        {downloadError ? <div>{downloadError}</div> : null}
        <button onClick={onDownload}>{isDownloading ? 'Preparing...' : 'Download'}</button>
      </div>
    ) : null,
}))

import { useFileUpload, useDocumentsStore } from '@/features/documents'

describe('FileSourcesTab', () => {
  afterEach(() => {
    global.URL.createObjectURL = originalCreateObjectURL
    global.URL.revokeObjectURL = originalRevokeObjectURL
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockCurrentConversation = {
      id: 'session-1',
      projectId: PROJECT_ID,
      knowledgeCollectionName: PROJECT_COLLECTION,
    }
    mockEnsureSession.mockReturnValue('session-1')
    mockProjectsState.currentProjectId = PROJECT_ID
    mockProjectsState.projects = [
      {
        id: PROJECT_ID,
        title: 'Alpha Project',
        knowledgeCollectionName: PROJECT_COLLECTION,
      },
    ]
    mockGetCachedUploadedFile.mockResolvedValue(null)
    mockCacheResolvedFile.mockResolvedValue(undefined)
    mockDownloadFile.mockResolvedValue({
      blob: new Blob(['pdf-data'], { type: 'application/pdf' }),
      fileName: 'document.pdf',
      contentType: 'application/pdf',
    })
    vi.mocked(useDocumentsStore).mockImplementation((selector) => {
      const state = {
        currentCollectionName: PROJECT_COLLECTION,
        isLoadingFiles: false,
        loadedSessionId: PROJECT_COLLECTION,
      }
      return (selector as (s: typeof state) => unknown)(state)
    })
    vi.mocked(useFileUpload).mockReturnValue({
      uploadFiles: mockUploadFiles,
      deleteFile: mockDeleteFile,
      sessionFiles: [],
      isUploading: false,
      isPolling: false,
      error: null,
      clearError: mockClearError,
    } as unknown as ReturnType<typeof useFileUpload>)
    mockGetFilePreview.mockResolvedValue({
      file_id: 'document.pdf',
      file_name: 'document.pdf',
      collection_name: PROJECT_COLLECTION,
      status: 'success',
      chunk_count: 2,
      metadata: {},
    })
    global.URL.createObjectURL = vi.fn(() => 'blob:preview')
    global.URL.revokeObjectURL = vi.fn()
  })

  test('renders empty state when no files', () => {
    render(<FileSourcesTab />)

    expect(screen.getByText('No Project Files')).toBeInTheDocument()
    expect(screen.getByText(/files uploaded to "Alpha Project" will be shared across chats/i)).toBeInTheDocument()
  })

  test('renders standalone empty state when no project is selected', () => {
    mockCurrentConversation = {
      id: 'session-1',
      projectId: undefined,
      knowledgeCollectionName: 'session-standalone',
    }
    mockProjectsState.currentProjectId = null

    render(<FileSourcesTab />)

    expect(screen.getByText('No Chat Files')).toBeInTheDocument()
    expect(
      screen.getByText(/files uploaded to this chat stay available only in this chat/i)
    ).toBeInTheDocument()
  })

  test('renders file upload zone in empty state', () => {
    render(<FileSourcesTab />)

    expect(screen.getByText('Upload Zone')).toBeInTheDocument()
  })

  test('uploads into the project collection when the session has no explicit collection', async () => {
    mockCurrentConversation = {
      id: 'session-1',
      projectId: PROJECT_ID,
      knowledgeCollectionName: undefined,
    }

    render(<FileSourcesTab />)

    fireEvent.click(screen.getByText('Upload Zone'))

    expect(mockEnsureSession).toHaveBeenCalled()
    expect(mockUploadFiles).toHaveBeenCalledWith(
      [expect.objectContaining({ name: 'test.pdf' })],
      PROJECT_COLLECTION
    )
  })

  test('renders file list when files exist', () => {
    vi.mocked(useFileUpload).mockReturnValue({
      uploadFiles: mockUploadFiles,
      deleteFile: mockDeleteFile,
      sessionFiles: [
        { id: 'file-1', fileName: 'document.pdf', status: 'success', collectionName: PROJECT_COLLECTION },
        { id: 'file-2', fileName: 'report.txt', status: 'uploading', collectionName: PROJECT_COLLECTION },
      ],
      isUploading: false,
      isPolling: false,
      error: null,
      clearError: mockClearError,
    } as unknown as ReturnType<typeof useFileUpload>)

    render(<FileSourcesTab />)

    expect(screen.getByTestId('file-card-file-1')).toHaveTextContent('document.pdf')
    expect(screen.getByTestId('file-card-file-2')).toHaveTextContent('report.txt')
  })

  test('shows file count in header', () => {
    vi.mocked(useFileUpload).mockReturnValue({
      uploadFiles: mockUploadFiles,
      deleteFile: mockDeleteFile,
      sessionFiles: [
        { id: 'file-1', fileName: 'doc.pdf', status: 'success', collectionName: PROJECT_COLLECTION },
      ],
      isUploading: false,
      isPolling: false,
      error: null,
      clearError: mockClearError,
    } as unknown as ReturnType<typeof useFileUpload>)

    render(<FileSourcesTab />)

    expect(screen.getByText(/project files \(1\)/i)).toBeInTheDocument()
  })

  test('shows chat file scope when viewing standalone files', () => {
    mockCurrentConversation = {
      id: 'session-1',
      projectId: undefined,
      knowledgeCollectionName: 'session-standalone',
    }
    mockProjectsState.currentProjectId = null

    vi.mocked(useFileUpload).mockReturnValue({
      uploadFiles: mockUploadFiles,
      deleteFile: mockDeleteFile,
      sessionFiles: [
        { id: 'file-1', fileName: 'doc.pdf', status: 'success', collectionName: 'session-standalone' },
      ],
      isUploading: false,
      isPolling: false,
      error: null,
      clearError: mockClearError,
    } as unknown as ReturnType<typeof useFileUpload>)

    render(<FileSourcesTab />)

    expect(screen.getByText(/chat files \(1\)/i)).toBeInTheDocument()
    expect(screen.getByText(/used only in this chat/i)).toBeInTheDocument()
  })

  test('uses project memory when a new project chat draft has no active conversation yet', () => {
    mockCurrentConversation = null
    mockProjectsState.currentProjectId = PROJECT_ID

    render(<FileSourcesTab />)

    expect(vi.mocked(useFileUpload)).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: undefined,
        collectionName: PROJECT_COLLECTION,
      })
    )
    expect(screen.getByText('No Project Files')).toBeInTheDocument()
    expect(screen.getByText(/files uploaded to "Alpha Project" will be shared across chats/i)).toBeInTheDocument()
  })

  test('opens delete confirmation modal when delete is clicked', async () => {
    const user = userEvent.setup()

    vi.mocked(useFileUpload).mockReturnValue({
      uploadFiles: mockUploadFiles,
      deleteFile: mockDeleteFile,
      sessionFiles: [
        { id: 'file-1', fileName: 'doc.pdf', status: 'success', collectionName: PROJECT_COLLECTION },
      ],
      isUploading: false,
      isPolling: false,
      error: null,
      clearError: mockClearError,
    } as unknown as ReturnType<typeof useFileUpload>)

    render(<FileSourcesTab />)

    await user.click(screen.getByRole('button', { name: /delete/i }))

    expect(screen.getByTestId('delete-modal')).toBeInTheDocument()
  })

  test('calls deleteFile when delete is confirmed', async () => {
    const user = userEvent.setup()

    vi.mocked(useFileUpload).mockReturnValue({
      uploadFiles: mockUploadFiles,
      deleteFile: mockDeleteFile,
      sessionFiles: [
        { id: 'file-1', fileName: 'doc.pdf', status: 'success', collectionName: PROJECT_COLLECTION },
      ],
      isUploading: false,
      isPolling: false,
      error: null,
      clearError: mockClearError,
    } as unknown as ReturnType<typeof useFileUpload>)

    render(<FileSourcesTab />)

    await user.click(screen.getByRole('button', { name: /delete/i }))
    await user.click(screen.getByRole('button', { name: /confirm delete/i }))

    expect(mockDeleteFile).toHaveBeenCalledWith('file-1')
  })

  test('shows processing spinner when uploading but sessionFiles is empty', () => {
    vi.mocked(useFileUpload).mockReturnValue({
      uploadFiles: mockUploadFiles,
      deleteFile: mockDeleteFile,
      sessionFiles: [],
      isUploading: true,
      isPolling: false,
      error: null,
      clearError: mockClearError,
    } as unknown as ReturnType<typeof useFileUpload>)

    render(<FileSourcesTab />)

    expect(screen.getByText('Checking for files...')).toBeInTheDocument()
    expect(screen.queryByText(/no files/i)).not.toBeInTheDocument()
  })

  test('shows processing spinner when polling but sessionFiles is empty', () => {
    vi.mocked(useFileUpload).mockReturnValue({
      uploadFiles: mockUploadFiles,
      deleteFile: mockDeleteFile,
      sessionFiles: [],
      isUploading: false,
      isPolling: true,
      error: null,
      clearError: mockClearError,
    } as unknown as ReturnType<typeof useFileUpload>)

    render(<FileSourcesTab />)

    expect(screen.getByText('Checking for files...')).toBeInTheDocument()
    expect(screen.queryByText(/no files/i)).not.toBeInTheDocument()
  })

  test('does not show processing spinner when sessionFiles exist', () => {
    vi.mocked(useFileUpload).mockReturnValue({
      uploadFiles: mockUploadFiles,
      deleteFile: mockDeleteFile,
      sessionFiles: [
        { id: 'file-1', fileName: 'doc.pdf', status: 'uploading', collectionName: PROJECT_COLLECTION },
      ],
      isUploading: true,
      isPolling: false,
      error: null,
      clearError: mockClearError,
    } as unknown as ReturnType<typeof useFileUpload>)

    render(<FileSourcesTab />)

    expect(screen.queryByText('Checking for files...')).not.toBeInTheDocument()
    expect(screen.getByTestId('file-card-file-1')).toBeInTheDocument()
  })

  test('does not show spinner when upload belongs to a different session', () => {
    // Active collection is a different session than the one rendered
    vi.mocked(useDocumentsStore).mockImplementation((selector) => {
      const state = {
        currentCollectionName: 'other-session-99',
        isLoadingFiles: false,
        loadedSessionId: PROJECT_COLLECTION,
      }
      return (selector as (s: typeof state) => unknown)(state)
    })

    vi.mocked(useFileUpload).mockReturnValue({
      uploadFiles: mockUploadFiles,
      deleteFile: mockDeleteFile,
      sessionFiles: [],
      isUploading: true,
      isPolling: true,
      error: null,
      clearError: mockClearError,
    } as unknown as ReturnType<typeof useFileUpload>)

    render(<FileSourcesTab />)

    // Spinner should NOT appear because the upload is for a different session
    expect(screen.queryByText('Checking for files...')).not.toBeInTheDocument()
    expect(screen.getByText('No Project Files')).toBeInTheDocument()
  })

  test('displays upload error when present', () => {
    vi.mocked(useFileUpload).mockReturnValue({
      uploadFiles: mockUploadFiles,
      deleteFile: mockDeleteFile,
      sessionFiles: [],
      isUploading: false,
      error: 'File too large',
      clearError: mockClearError,
    } as unknown as ReturnType<typeof useFileUpload>)

    render(<FileSourcesTab />)

    expect(screen.getByText('File too large')).toBeInTheDocument()
  })

  test('opens file preview when view is clicked', async () => {
    const user = userEvent.setup()

    vi.mocked(useFileUpload).mockReturnValue({
      uploadFiles: mockUploadFiles,
      deleteFile: mockDeleteFile,
      sessionFiles: [
        { id: 'file-1', fileName: 'document.pdf', status: 'success', collectionName: PROJECT_COLLECTION },
      ],
      isUploading: false,
      isPolling: false,
      error: null,
      clearError: mockClearError,
    } as unknown as ReturnType<typeof useFileUpload>)

    render(<FileSourcesTab />)

    await user.click(screen.getByRole('button', { name: /view/i }))

    expect(mockGetFilePreview).toHaveBeenCalledWith(PROJECT_COLLECTION, 'document.pdf')
    expect(screen.getByTestId('file-preview-modal')).toHaveTextContent('document.pdf')
  })

  test('falls back to local file metadata when preview endpoint is unavailable', async () => {
    const user = userEvent.setup()
    mockGetFilePreview.mockRejectedValueOnce(new Error('Backend returned 404: {"detail":"Not Found"}'))

    vi.mocked(useFileUpload).mockReturnValue({
      uploadFiles: mockUploadFiles,
      deleteFile: mockDeleteFile,
      sessionFiles: [
        {
          id: 'file-1',
          fileName: 'document.pdf',
          fileSize: 2048,
          status: 'success',
          collectionName: PROJECT_COLLECTION,
          uploadedAt: '2026-04-07T20:00:00.000Z',
        },
      ],
      isUploading: false,
      isPolling: false,
      error: null,
      clearError: mockClearError,
    } as unknown as ReturnType<typeof useFileUpload>)

    render(<FileSourcesTab />)

    await user.click(screen.getByRole('button', { name: /view/i }))

    expect(screen.getByTestId('file-preview-modal')).toHaveTextContent('document.pdf')
    expect(screen.getByTestId('file-preview-modal')).not.toHaveTextContent('Backend returned 404')
  })

  test('downloads the original file from the preview modal', async () => {
    const user = userEvent.setup()

    vi.mocked(useFileUpload).mockReturnValue({
      uploadFiles: mockUploadFiles,
      deleteFile: mockDeleteFile,
      sessionFiles: [
        {
          id: 'file-1',
          fileName: 'document.pdf',
          serverFileId: 'server-file-1',
          status: 'success',
          collectionName: PROJECT_COLLECTION,
        },
      ],
      isUploading: false,
      isPolling: false,
      error: null,
      clearError: mockClearError,
    } as unknown as ReturnType<typeof useFileUpload>)

    mockGetFilePreview.mockResolvedValueOnce({
      file_id: 'server-file-1',
      file_name: 'document.pdf',
      collection_name: PROJECT_COLLECTION,
      status: 'success',
      chunk_count: 2,
      metadata: {},
    })

    render(<FileSourcesTab />)

    const mockClick = vi.fn()
    const mockAnchor = { href: '', download: '', rel: '', click: mockClick, remove: vi.fn() }
    const originalCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName.toLowerCase() === 'a') {
        return mockAnchor as unknown as HTMLAnchorElement
      }
      return originalCreateElement(tagName)
    })
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => mockAnchor as unknown as Node)

    await user.click(screen.getByRole('button', { name: /view/i }))
    await user.click(screen.getByRole('button', { name: /download/i }))

    expect(mockDownloadFile).toHaveBeenCalledWith(PROJECT_COLLECTION, 'server-file-1')
    expect(URL.createObjectURL).toHaveBeenCalled()
    expect(mockClick).toHaveBeenCalled()
  })

  test('falls back to cached uploaded file when backend download is unavailable', async () => {
    const user = userEvent.setup()
    const cachedFile = new File(['cached'], 'document.pdf', { type: 'application/pdf' })

    vi.mocked(useFileUpload).mockReturnValue({
      uploadFiles: mockUploadFiles,
      deleteFile: mockDeleteFile,
      sessionFiles: [
        {
          id: 'file-1',
          fileName: 'document.pdf',
          serverFileId: 'server-file-1',
          status: 'success',
          collectionName: PROJECT_COLLECTION,
        },
      ],
      isUploading: false,
      isPolling: false,
      error: null,
      clearError: mockClearError,
    } as unknown as ReturnType<typeof useFileUpload>)

    mockGetFilePreview.mockResolvedValueOnce({
      file_id: 'server-file-1',
      file_name: 'document.pdf',
      collection_name: PROJECT_COLLECTION,
      status: 'success',
      chunk_count: 2,
      metadata: {},
    })
    mockDownloadFile.mockRejectedValueOnce(
      new Error('Original uploaded file is not available for download')
    )
    mockGetCachedUploadedFile.mockResolvedValueOnce(cachedFile)

    render(<FileSourcesTab />)

    const mockClick = vi.fn()
    const mockAnchor = { href: '', download: '', rel: '', click: mockClick, remove: vi.fn() }
    const originalCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName.toLowerCase() === 'a') {
        return mockAnchor as unknown as HTMLAnchorElement
      }
      return originalCreateElement(tagName)
    })
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => mockAnchor as unknown as Node)

    await user.click(screen.getByRole('button', { name: /view/i }))
    await user.click(screen.getByRole('button', { name: /download/i }))

    expect(mockGetCachedUploadedFile).toHaveBeenCalledWith(
      PROJECT_COLLECTION,
      'server-file-1',
      'document.pdf'
    )
    expect(mockClick).toHaveBeenCalled()
    expect(screen.getByTestId('file-preview-modal')).not.toHaveTextContent(/re-upload it once/i)
  })
})
