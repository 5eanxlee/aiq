// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { render, screen } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { vi, describe, test, expect, beforeEach } from 'vitest'
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

let lastAppBarProps: Record<string, unknown> | null = null
let lastSessionsPanelProps: Record<string, unknown> | null = null

interface MockConversation {
  id: string
  title: string
  updatedAt: string
  projectId?: string
  messages: unknown[]
}

interface MockChatState {
  currentConversation: MockConversation | null
  currentUserId: string | null
  getUserConversations: () => MockConversation[]
  selectConversation: typeof mockSelectConversation
  startNewSessionDraft: typeof mockStartNewSessionDraft
  deleteConversation: typeof mockDeleteConversation
  updateConversationTitle: typeof mockUpdateConversationTitle
  replaceUserConversations: typeof mockReplaceUserConversations
  isStreaming: boolean
  pendingInteraction: unknown
  isDeepResearchStreaming: boolean
  deepResearchOwnerConversationId: string | null
}

interface MockProjectsState {
  projects: Array<{
    id: string
    title: string
    updatedAt: string
    knowledgeCollectionName: string
  }>
  currentProjectId: string | null
  setCurrentProjectId: typeof mockSetCurrentProjectId
  upsertProject: typeof mockUpsertProject
  removeProject: typeof mockRemoveProject
}

const defaultProject = {
  id: 'project-1',
  title: 'Project Atlas',
  updatedAt: '2026-04-08T14:00:00.000Z',
  knowledgeCollectionName: 'project_atlas',
}

const standaloneConversation: MockConversation = {
  id: 'standalone-1',
  title: 'Standalone Session',
  updatedAt: '2026-04-08T15:00:00.000Z',
  messages: [],
}

const projectConversation: MockConversation = {
  id: 'project-session-1',
  title: 'Project Session',
  updatedAt: '2026-04-08T16:00:00.000Z',
  projectId: defaultProject.id,
  messages: [],
}

const defaultChatState: MockChatState = {
  currentConversation: projectConversation,
  currentUserId: 'user-1',
  getUserConversations: () => [projectConversation],
  selectConversation: mockSelectConversation,
  startNewSessionDraft: mockStartNewSessionDraft,
  deleteConversation: mockDeleteConversation,
  updateConversationTitle: mockUpdateConversationTitle,
  replaceUserConversations: mockReplaceUserConversations,
  isStreaming: false,
  pendingInteraction: null,
  isDeepResearchStreaming: false,
  deepResearchOwnerConversationId: null,
}

const defaultProjectsState: MockProjectsState = {
  projects: [defaultProject],
  currentProjectId: defaultProject.id,
  setCurrentProjectId: mockSetCurrentProjectId,
  upsertProject: mockUpsertProject,
  removeProject: mockRemoveProject,
}

let mockChatState: MockChatState = { ...defaultChatState }
let mockProjectsState: MockProjectsState = { ...defaultProjectsState }

vi.mock('@/hooks/use-session-url', () => ({
  useSessionUrl: vi.fn(() => ({
    updateRouteUrl: mockUpdateRouteUrl,
    clearSessionUrl: vi.fn(),
  })),
}))

vi.mock('@/adapters/api', () => ({
  createProjectsClient: vi.fn(() => ({
    createProject: vi.fn(),
    updateProject: vi.fn(),
    deleteProject: vi.fn(),
    deleteSession: vi.fn(),
    updateSession: vi.fn(),
  })),
}))

vi.mock('@/adapters/auth', () => ({
  useAuth: () => ({
    idToken: undefined,
  }),
}))

vi.mock('@/features/chat', () => ({
  useChatStore: vi.fn((selector?: (state: MockChatState) => unknown) =>
    selector ? selector(mockChatState) : mockChatState
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
  useLayoutStore: vi.fn(() => ({
    rightPanel: null,
    closeRightPanel: mockCloseRightPanel,
  })),
}))

vi.mock('@/hooks/use-reduced-motion', () => ({
  useReducedMotion: () => false,
}))

vi.mock('./AppBar', () => ({
  AppBar: (props: Record<string, unknown>) => {
    lastAppBarProps = props
    return (
      <div data-testid="app-bar">
        <div>{String(props.sessionTitle ?? '')}</div>
        <div data-testid="app-bar-scope">
          {props.isStandaloneScope ? 'standalone' : 'project'}
        </div>
        <button
          type="button"
          onClick={props.onNewSession as (() => void) | undefined}
          disabled={Boolean(props.isNewSessionDisabled)}
        >
          Header New Session
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
        <button type="button" onClick={props.onSelectStandalone as (() => void) | undefined}>
          Select Standalone
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
    mockChatState = { ...defaultChatState }
    mockProjectsState = { ...defaultProjectsState }
  })

  test('renders all main sections', () => {
    render(<MainLayout isAuthenticated={true} />)

    expect(screen.getByTestId('app-bar')).toBeInTheDocument()
    expect(screen.getByTestId('sessions-panel')).toBeInTheDocument()
    expect(screen.getByTestId('chat-area')).toBeInTheDocument()
    expect(screen.getByTestId('input-area')).toBeInTheDocument()
    expect(screen.getByTestId('research-panel')).toBeInTheDocument()
    expect(screen.getByTestId('data-sources-panel')).toBeInTheDocument()
    expect(screen.getByTestId('providers-panel')).toBeInTheDocument()
    expect(screen.getByTestId('settings-panel')).toBeInTheDocument()
  })

  test('passes standalone scope to the header and sidebar when no project is active', () => {
    mockChatState = {
      ...mockChatState,
      currentConversation: standaloneConversation,
      getUserConversations: () => [standaloneConversation, projectConversation],
    }
    mockProjectsState = {
      ...mockProjectsState,
      currentProjectId: null,
    }

    render(<MainLayout isAuthenticated={true} />)

    expect(screen.getByTestId('app-bar-scope')).toHaveTextContent('standalone')
    expect(lastAppBarProps?.isStandaloneScope).toBe(true)
    expect(lastSessionsPanelProps?.isStandaloneScope).toBe(true)
    expect(lastSessionsPanelProps?.sessions).toEqual([
      expect.objectContaining({ id: standaloneConversation.id }),
    ])
  })

  test('header new chat action clears project scope and route state', async () => {
    const user = userEvent.setup()

    render(<MainLayout isAuthenticated={true} />)

    await user.click(screen.getByRole('button', { name: /header new session/i }))

    expect(mockSetCurrentProjectId).toHaveBeenCalledWith(null)
    expect(mockStartNewSessionDraft).toHaveBeenCalledOnce()
    expect(mockUpdateRouteUrl).toHaveBeenCalledWith(null, null)
    expect(mockCloseRightPanel).toHaveBeenCalledOnce()
  })

  test('selecting standalone scope opens the newest standalone conversation', async () => {
    const user = userEvent.setup()
    const olderStandalone = {
      ...standaloneConversation,
      id: 'standalone-older',
      updatedAt: '2026-04-07T10:00:00.000Z',
    }
    const newerStandalone = {
      ...standaloneConversation,
      id: 'standalone-newer',
      updatedAt: '2026-04-08T18:00:00.000Z',
    }
    mockChatState = {
      ...mockChatState,
      currentConversation: projectConversation,
      getUserConversations: () => [projectConversation, olderStandalone, newerStandalone],
    }

    render(<MainLayout isAuthenticated={true} />)

    await user.click(screen.getByRole('button', { name: /select standalone/i }))

    expect(mockSetCurrentProjectId).toHaveBeenCalledWith(null)
    expect(mockSelectConversation).toHaveBeenCalledWith('standalone-newer')
    expect(mockUpdateRouteUrl).toHaveBeenCalledWith(null, 'standalone-newer')
  })

  test('disables the header new chat action while shallow streaming is active', () => {
    mockChatState = {
      ...mockChatState,
      isStreaming: true,
    }

    render(<MainLayout isAuthenticated={true} />)

    expect(screen.getByRole('button', { name: /header new session/i })).toBeDisabled()
  })
})
