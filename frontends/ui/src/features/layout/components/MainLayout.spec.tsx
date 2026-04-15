// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { render, screen } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { MainLayout } from './MainLayout'

const mockUpdateRouteUrl = vi.fn()
const mockSelectConversation = vi.fn()
const mockStartNewSessionDraft = vi.fn()
const mockDeleteConversation = vi.fn()
const mockUpdateConversationTitle = vi.fn()
const mockReplaceUserConversations = vi.fn()
const mockCloseRightPanel = vi.fn()
const mockSetCurrentProjectId = vi.fn()
const mockUpsertProject = vi.fn()
const mockRemoveProject = vi.fn()
const mockPatchConversationMessage = vi.fn()
const mockAddDeepResearchBanner = vi.fn()
const mockPersistDeepResearchToSession = vi.fn()
const mockCreateProject = vi.fn()
const mockUpdateProject = vi.fn()
const mockDeleteProject = vi.fn()
const mockDeleteSession = vi.fn()
const mockUpdateSession = vi.fn()

let lastAppBarProps: Record<string, unknown> | null = null
let lastSessionsPanelProps: Record<string, unknown> | null = null
let mockRightPanel: string | null = null
let mockResearchPanelMode: 'split' | 'full-width' = 'split'
let mockResearchPanelWidthPercent = 60
let mockIsResearchPanelResizing = false

interface MockConversation {
  id: string
  userId: string
  title: string
  updatedAt: string
  projectId?: string
  messages: Array<{
    id?: string
    messageType?: string
    deepResearchJobId?: string | null
    deepResearchJobStatus?: string | null
    deepResearchDurationMs?: number | null
    deepResearchStartedAtMs?: number | null
  }>
}

interface MockChatState {
  currentConversation: MockConversation | null
  currentUserId: string | null
  conversations: MockConversation[]
  getUserConversations: () => MockConversation[]
  selectConversation: typeof mockSelectConversation
  startNewSessionDraft: typeof mockStartNewSessionDraft
  deleteConversation: typeof mockDeleteConversation
  updateConversationTitle: typeof mockUpdateConversationTitle
  replaceUserConversations: typeof mockReplaceUserConversations
  patchConversationMessage: typeof mockPatchConversationMessage
  addDeepResearchBanner: typeof mockAddDeepResearchBanner
  persistDeepResearchToSession: typeof mockPersistDeepResearchToSession
  isStreaming: boolean
  pendingInteraction: unknown
  isDeepResearchStreaming: boolean
  deepResearchOwnerConversationId: string | null
}

interface MockProjectsState {
  projects: Array<{
    id: string
    ownerId?: string
    title: string
    updatedAt: string
    knowledgeCollectionName: string
  }>
  currentProjectId: string | null
  setCurrentProjectId: typeof mockSetCurrentProjectId
  upsertProject: typeof mockUpsertProject
  removeProject: typeof mockRemoveProject
}

const project = {
  id: 'project-1',
  title: 'Project Atlas',
  updatedAt: '2026-04-08T16:00:00.000Z',
  knowledgeCollectionName: 'project_atlas',
}

const rootConversation: MockConversation = {
  id: 'root-1',
  userId: 'user-1',
  title: 'Root Chat',
  updatedAt: '2026-04-08T14:00:00.000Z',
  messages: [],
}

const projectConversation: MockConversation = {
  id: 'project-1-chat',
  userId: 'user-1',
  title: 'Project Chat',
  updatedAt: '2026-04-08T15:00:00.000Z',
  projectId: project.id,
  messages: [],
}

const getMockUserConversations = () =>
  mockChatState.currentUserId
    ? mockChatState.conversations.filter(
        (conversation) => conversation.userId === mockChatState.currentUserId
      )
    : []

let mockChatState: MockChatState = {
  currentConversation: projectConversation,
  currentUserId: 'user-1',
  conversations: [projectConversation],
  getUserConversations: getMockUserConversations,
  selectConversation: mockSelectConversation,
  startNewSessionDraft: mockStartNewSessionDraft,
  deleteConversation: mockDeleteConversation,
  updateConversationTitle: mockUpdateConversationTitle,
  replaceUserConversations: mockReplaceUserConversations,
  patchConversationMessage: mockPatchConversationMessage,
  addDeepResearchBanner: mockAddDeepResearchBanner,
  persistDeepResearchToSession: mockPersistDeepResearchToSession,
  isStreaming: false,
  pendingInteraction: null,
  isDeepResearchStreaming: false,
  deepResearchOwnerConversationId: null,
}

let mockProjectsState: MockProjectsState = {
  projects: [project],
  currentProjectId: project.id,
  setCurrentProjectId: mockSetCurrentProjectId,
  upsertProject: mockUpsertProject,
  removeProject: mockRemoveProject,
}

vi.mock('@/hooks/use-session-url', () => ({
  useSessionUrl: () => ({
    updateRouteUrl: mockUpdateRouteUrl,
    clearSessionUrl: vi.fn(),
  }),
}))

vi.mock('@/adapters/api', () => ({
  createProjectsClient: () => ({
    createProject: mockCreateProject,
    updateProject: mockUpdateProject,
    deleteProject: mockDeleteProject,
    deleteSession: mockDeleteSession,
    updateSession: mockUpdateSession,
  }),
}))

vi.mock('@/adapters/auth', () => ({
  useAuth: () => ({
    idToken: undefined,
  }),
}))

vi.mock('@/features/chat', () => ({
  useChatStore: Object.assign(
    vi.fn((selector?: (state: MockChatState) => unknown) =>
      selector ? selector(mockChatState) : mockChatState
    ),
    {
      getState: () => mockChatState,
    }
  ),
  useDeepResearch: vi.fn(),
  NoSourcesBanner: () => <div data-testid="no-sources-banner">No Sources Banner</div>,
}))

vi.mock('@/features/projects', () => ({
  useProjectsStore: vi.fn((selector?: (state: MockProjectsState) => unknown) =>
    selector ? selector(mockProjectsState) : mockProjectsState
  ),
}))

vi.mock('../store', () => ({
  useLayoutStore: vi.fn((selector?: (state: Record<string, unknown>) => unknown) => {
    const state = {
      rightPanel: mockRightPanel,
      researchPanelMode: mockResearchPanelMode,
      researchPanelWidthPercent: mockResearchPanelWidthPercent,
      isResearchPanelResizing: mockIsResearchPanelResizing,
      closeRightPanel: mockCloseRightPanel,
    }
    return selector ? selector(state) : state
  }),
}))

vi.mock('@/hooks/use-reduced-motion', () => ({
  useReducedMotion: () => false,
}))

vi.mock('./AppBar', () => ({
  AppBar: (props: Record<string, unknown>) => {
    lastAppBarProps = props
    return (
      <div data-testid="app-bar">
        <button
          type="button"
          onClick={props.onNewChat as (() => void) | undefined}
          disabled={Boolean(props.isNewChatDisabled)}
        >
          Header New Chat
        </button>
      </div>
    )
  },
}))

vi.mock('./SessionsPanel', () => ({
  SessionsPanel: (props: Record<string, unknown>) => {
    lastSessionsPanelProps = props
    return (
      <div data-testid="sessions-panel">
        <button type="button" onClick={props.onSelectRoot as (() => void) | undefined}>
          Select Root
        </button>
        <button
          type="button"
          onClick={() => (props.onSelectProject as ((projectId: string) => void) | undefined)?.('project-1')}
        >
          Select Project
        </button>
        <button
          type="button"
          onClick={() => (props.onSelectSession as ((sessionId: string) => void) | undefined)?.('root-newer')}
        >
          Select Chat
        </button>
      </div>
    )
  },
}))

vi.mock('./ChatArea', () => ({
  ChatArea: () => <div data-testid="chat-area">Chat Area</div>,
}))

vi.mock('./InputArea', () => ({
  InputArea: () => <div data-testid="input-area">Input Area</div>,
}))

vi.mock('./ResearchPanel', () => ({
  ResearchPanel: () => <div data-testid="research-panel">Research Panel</div>,
}))

vi.mock('./DataSourcesPanel', () => ({
  DataSourcesPanel: () => <div data-testid="data-sources-panel">Data Sources Panel</div>,
}))

vi.mock('./ProvidersPanel', () => ({
  ProvidersPanel: () => <div data-testid="providers-panel">Providers Panel</div>,
}))

vi.mock('./SettingsPanel', () => ({
  SettingsPanel: () => <div data-testid="settings-panel">Settings Panel</div>,
}))

describe('MainLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    lastAppBarProps = null
    lastSessionsPanelProps = null
    mockRightPanel = null
    mockResearchPanelMode = 'split'
    mockResearchPanelWidthPercent = 60
    mockIsResearchPanelResizing = false
    mockChatState = {
      ...mockChatState,
      currentConversation: projectConversation,
      currentUserId: 'user-1',
      conversations: [projectConversation],
      getUserConversations: getMockUserConversations,
      isStreaming: false,
      pendingInteraction: null,
      isDeepResearchStreaming: false,
      deepResearchOwnerConversationId: null,
    }
    mockProjectsState = {
      ...mockProjectsState,
      projects: [project],
      currentProjectId: project.id,
    }
    mockCreateProject.mockResolvedValue({
      id: 'project-2',
      owner_id: 'user-1',
      title: 'New Project',
      description: null,
      knowledge_collection_name: 'project_2',
      created_at: '2026-04-08T18:00:00.000Z',
      updated_at: '2026-04-08T18:00:00.000Z',
    })
    mockDeleteSession.mockResolvedValue(undefined)
    mockUpdateSession.mockResolvedValue(undefined)
  })

  test('renders the main sections without workspace tabs', () => {
    render(<MainLayout isAuthenticated={true} />)

    expect(screen.getByTestId('app-bar')).toBeInTheDocument()
    expect(screen.getByTestId('sessions-panel')).toBeInTheDocument()
    expect(screen.getByTestId('chat-area')).toBeInTheDocument()
    expect(screen.getByTestId('input-area')).toBeInTheDocument()
    expect(screen.getByTestId('research-panel')).toBeInTheDocument()
    expect(screen.getByTestId('data-sources-panel')).toBeInTheDocument()
    expect(screen.getByTestId('providers-panel')).toBeInTheDocument()
    expect(screen.getByTestId('settings-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('workspace-tab-strip')).not.toBeInTheDocument()
  })

  test('passes root chat context when no project is active', () => {
    mockChatState = {
      ...mockChatState,
      currentConversation: rootConversation,
      conversations: [rootConversation, projectConversation],
    }
    mockProjectsState = {
      ...mockProjectsState,
      currentProjectId: null,
    }

    render(<MainLayout isAuthenticated={true} />)

    expect(lastAppBarProps?.isProjectContext).toBe(false)
    expect(lastAppBarProps?.chatTitle).toBe('Root Chat')
    expect(lastSessionsPanelProps?.selectedProjectId).toBeUndefined()
    expect(lastSessionsPanelProps?.sessions).toEqual([
      expect.objectContaining({ id: rootConversation.id, title: rootConversation.title }),
    ])
  })

  test('new chat keeps the active project context', async () => {
    const user = userEvent.setup()

    render(<MainLayout isAuthenticated={true} />)

    await user.click(screen.getByRole('button', { name: /header new chat/i }))

    expect(mockSetCurrentProjectId).toHaveBeenCalledWith(project.id)
    expect(mockStartNewSessionDraft).toHaveBeenCalledOnce()
    expect(mockUpdateRouteUrl).toHaveBeenCalledWith(project.id, null)
    expect(mockCloseRightPanel).toHaveBeenCalledOnce()
  })

  test('selecting root chooses the newest unprojected chat', async () => {
    const user = userEvent.setup()
    const newerRootConversation = {
      ...rootConversation,
      id: 'root-newer',
      updatedAt: '2026-04-08T19:00:00.000Z',
    }
    const olderRootConversation = {
      ...rootConversation,
      id: 'root-older',
      updatedAt: '2026-04-07T19:00:00.000Z',
    }

    mockChatState = {
      ...mockChatState,
      currentConversation: projectConversation,
      conversations: [projectConversation, olderRootConversation, newerRootConversation],
    }

    render(<MainLayout isAuthenticated={true} />)

    await user.click(screen.getByRole('button', { name: /select root/i }))

    expect(mockSelectConversation).toHaveBeenCalledWith('root-newer')
    expect(mockUpdateRouteUrl).toHaveBeenCalledWith(null, 'root-newer')
  })

  test('selecting a project chooses the newest project chat', async () => {
    const user = userEvent.setup()
    const olderProjectConversation = {
      ...projectConversation,
      id: 'project-older',
      updatedAt: '2026-04-07T10:00:00.000Z',
    }
    const newerProjectConversation = {
      ...projectConversation,
      id: 'project-newer',
      updatedAt: '2026-04-08T20:00:00.000Z',
    }

    mockChatState = {
      ...mockChatState,
      currentConversation: rootConversation,
      conversations: [rootConversation, olderProjectConversation, newerProjectConversation],
    }
    mockProjectsState = {
      ...mockProjectsState,
      currentProjectId: null,
    }

    render(<MainLayout isAuthenticated={true} />)

    await user.click(screen.getByRole('button', { name: /select project/i }))

    expect(mockSelectConversation).toHaveBeenCalledWith('project-newer')
    expect(mockUpdateRouteUrl).toHaveBeenCalledWith(project.id, 'project-newer')
  })

  test('recomputes sidebar chats from live conversations after a delete', () => {
    const deletedConversation = {
      ...projectConversation,
      id: 'project-deleted',
      title: 'Deleted Chat',
      updatedAt: '2026-04-08T17:00:00.000Z',
    }

    mockChatState = {
      ...mockChatState,
      currentConversation: projectConversation,
      conversations: [projectConversation, deletedConversation],
      getUserConversations: () => [projectConversation, deletedConversation],
    }

    const { rerender } = render(<MainLayout isAuthenticated={true} />)

    expect(lastSessionsPanelProps?.sessions).toEqual([
      expect.objectContaining({ id: deletedConversation.id, title: deletedConversation.title }),
      expect.objectContaining({ id: projectConversation.id, title: projectConversation.title }),
    ])

    mockChatState = {
      ...mockChatState,
      conversations: [projectConversation],
      getUserConversations: () => [projectConversation, deletedConversation],
    }

    rerender(<MainLayout isAuthenticated={true} />)

    expect(lastSessionsPanelProps?.sessions).toEqual([
      expect.objectContaining({ id: projectConversation.id, title: projectConversation.title }),
    ])
  })

  test('disables the header new chat action while navigation is blocked', () => {
    mockChatState = {
      ...mockChatState,
      isStreaming: true,
    }

    render(<MainLayout isAuthenticated={true} />)

    expect(screen.getByRole('button', { name: /header new chat/i })).toBeDisabled()
  })

  test('collapses the chat pane when research is expanded to full width', () => {
    mockRightPanel = 'research'
    mockResearchPanelMode = 'full-width'
    mockResearchPanelWidthPercent = 100

    render(<MainLayout isAuthenticated={true} />)

    expect(screen.getByTestId('main-layout-chat-pane')).toHaveStyle({
      width: '0%',
      opacity: '0',
      pointerEvents: 'none',
    })
  })
})
