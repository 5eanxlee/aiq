// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { render, screen } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { SessionsPanel } from './SessionsPanel'

const mockSetSessionsPanelOpen = vi.fn()

const mockLayoutState = {
  isSessionsPanelOpen: true,
  setSessionsPanelOpen: mockSetSessionsPanelOpen,
}

const createChatState = (overrides?: Partial<{
  isSessionBusy: (conversationId: string) => boolean
  hasAnyBusySession: () => boolean
  isStreaming: boolean
  pendingInteraction: unknown
}>) => ({
  isSessionBusy: overrides?.isSessionBusy ?? (() => false),
  hasAnyBusySession: overrides?.hasAnyBusySession ?? (() => false),
  isStreaming: overrides?.isStreaming ?? false,
  pendingInteraction: overrides?.pendingInteraction ?? null,
})

let mockChatState = createChatState()

vi.mock('../store', () => ({
  useLayoutStore: vi.fn((selector?: (state: typeof mockLayoutState) => unknown) =>
    typeof selector === 'function' ? selector(mockLayoutState) : mockLayoutState
  ),
}))

vi.mock('@/features/chat', () => ({
  useChatStore: vi.fn((selector: (state: typeof mockChatState) => unknown) => selector(mockChatState)),
}))

vi.mock('@/features/chat/lib/storage-manager', () => ({
  checkStorageHealth: () => ({ percentUsed: 24 }),
}))

vi.mock('./FileSourcesTab', () => ({
  FileSourcesTab: () => <div data-testid="project-sources-tab">Project Sources Tab</div>,
}))

vi.mock('./DeleteSessionConfirmationModal', () => ({
  DeleteSessionConfirmationModal: () => null,
}))

vi.mock('./DeleteAllSessionsConfirmationModal', () => ({
  DeleteAllSessionsConfirmationModal: () => null,
}))

describe('SessionsPanel', () => {
  const today = new Date('2026-04-08T12:00:00.000Z')
  const yesterday = new Date('2026-04-07T12:00:00.000Z')
  const sessions = [
    { id: 'chat-1', title: 'Root Chat', date: today },
    { id: 'chat-2', title: 'Older Chat', date: yesterday },
  ]
  const projects = [
    { id: 'project-1', title: 'Atlas', date: today },
    { id: 'project-2', title: 'Orion', date: yesterday },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    mockLayoutState.isSessionsPanelOpen = true
    mockChatState = createChatState()
  })

  test('renders root mode with chats and projects', () => {
    render(<SessionsPanel sessions={sessions} projects={projects} />)

    expect(screen.getAllByText('Chats').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /new chat/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /new project/i })).toBeInTheDocument()
    expect(screen.getByText('Projects')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /chat: root chat/i })).toBeInTheDocument()
    expect(screen.getByText('Atlas')).toBeInTheDocument()
  })

  test('shows the root empty state copy', () => {
    render(<SessionsPanel sessions={[]} projects={[]} />)

    expect(screen.getByText('No chats yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /start a new chat/i })).toBeInTheDocument()
  })

  test('starts a new root chat and closes the sidebar', async () => {
    const user = userEvent.setup()
    const onNewSession = vi.fn()

    render(<SessionsPanel sessions={sessions} projects={projects} onNewSession={onNewSession} />)

    await user.click(screen.getByRole('button', { name: /^new chat$/i }))

    expect(onNewSession).toHaveBeenCalledOnce()
    expect(mockSetSessionsPanelOpen).toHaveBeenCalledWith(false)
  })

  test('selects a chat and closes the sidebar', async () => {
    const user = userEvent.setup()
    const onSelectSession = vi.fn()

    render(
      <SessionsPanel sessions={sessions} projects={projects} onSelectSession={onSelectSession} />
    )

    await user.click(screen.getByRole('button', { name: /chat: root chat/i }))

    expect(onSelectSession).toHaveBeenCalledWith('chat-1')
    expect(mockSetSessionsPanelOpen).toHaveBeenCalledWith(false)
  })

  test('enters project mode and shows chats and sources tabs', async () => {
    const user = userEvent.setup()
    const onSelectRoot = vi.fn()

    render(
      <SessionsPanel
        projects={projects}
        sessions={sessions}
        selectedProjectId="project-1"
        onSelectRoot={onSelectRoot}
      />
    )

    expect(screen.getByText('Atlas')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /chats/i })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /sources/i })).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /sources/i }))
    expect(screen.getByTestId('project-sources-tab')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /back to chats/i }))
    expect(onSelectRoot).toHaveBeenCalledOnce()
  })

  test('selects a project from root mode', async () => {
    const user = userEvent.setup()
    const onSelectProject = vi.fn()

    render(
      <SessionsPanel sessions={sessions} projects={projects} onSelectProject={onSelectProject} />
    )

    await user.click(screen.getByText('Atlas'))

    expect(onSelectProject).toHaveBeenCalledWith('project-1')
  })

  test('hides content when the sidebar is closed', () => {
    mockLayoutState.isSessionsPanelOpen = false

    render(<SessionsPanel sessions={sessions} projects={projects} />)

    expect(screen.queryByText('Chats')).not.toBeInTheDocument()
  })
})
