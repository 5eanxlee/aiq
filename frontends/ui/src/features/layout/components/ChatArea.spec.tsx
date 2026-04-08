// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { render, screen } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { vi, describe, test, expect, beforeEach } from 'vitest'
import { ChatArea } from './ChatArea'

// Mock the chat store
const mockRespondToPrompt = vi.fn()
const mockDismissErrorCard = vi.fn()
const mockGetThinkingStepsForMessage = vi.fn((_messageId: string) => [] as { id: string; displayName: string }[])
const mockChatThinking = vi.fn((_props: unknown) => <div data-testid="chat-thinking">Thinking...</div>)

interface MockChatState {
  currentConversation: { messages: unknown[] } | null
  isStreaming: boolean
  currentUserMessageId: string | null
  respondToPrompt: typeof mockRespondToPrompt
  dismissErrorCard: typeof mockDismissErrorCard
  getThinkingStepsForMessage: typeof mockGetThinkingStepsForMessage
}

const defaultChatState: MockChatState = {
  currentConversation: { messages: [] },
  isStreaming: false,
  currentUserMessageId: null,
  respondToPrompt: mockRespondToPrompt,
  dismissErrorCard: mockDismissErrorCard,
  getThinkingStepsForMessage: mockGetThinkingStepsForMessage,
}

let mockChatState: MockChatState = { ...defaultChatState }

vi.mock('@/features/chat', () => ({
  useChatStore: vi.fn((selector?: (state: MockChatState) => unknown) =>
    selector ? selector(mockChatState) : mockChatState
  ),
  AgentPrompt: ({ content }: { content: string }) => (
    <div data-testid="agent-prompt">{content}</div>
  ),
  AgentResponse: ({ content }: { content: string }) => (
    <div data-testid="agent-response">{content}</div>
  ),
  ErrorBanner: ({ message }: { message: string }) => <div data-testid="error-card">{message}</div>,
  FileUploadBanner: ({ type }: { type: string }) => <div data-testid="file-banner">{type}</div>,
  UserMessage: ({ content }: { content: string }) => (
    <div data-testid="user-message">{content}</div>
  ),
  ChatThinking: (props: unknown) => mockChatThinking(props),
}))

describe('ChatArea', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockChatState = { ...defaultChatState }
  })

  test('renders welcome state when not authenticated', () => {
    render(<ChatArea isAuthenticated={false} />)

    expect(screen.getByText('Welcome to AI-Q')).toBeInTheDocument()
    expect(screen.getByText(/sign in with your account/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in with.*sso/i })).toBeInTheDocument()
  })

  test('renders welcome state when authenticated with no messages', () => {
    render(<ChatArea isAuthenticated={true} />)

    expect(screen.getByText('Welcome to AI-Q')).toBeInTheDocument()
    expect(screen.getByText(/AI-powered research companion/i)).toBeInTheDocument()
  })

  test('calls onSignIn when sign in button clicked', async () => {
    const user = userEvent.setup()
    const onSignIn = vi.fn()

    render(<ChatArea isAuthenticated={false} onSignIn={onSignIn} />)

    await user.click(screen.getByRole('button', { name: /sign in with.*sso/i }))

    expect(onSignIn).toHaveBeenCalled()
  })

  test('renders user messages', () => {
    mockChatState = {
      ...mockChatState,
      currentConversation: {
        messages: [{ id: 'msg-1', role: 'user', content: 'Hello world', messageType: 'user' }],
      },
    }

    render(<ChatArea isAuthenticated={true} />)

    expect(screen.getByTestId('user-message')).toHaveTextContent('Hello world')
  })

  test('renders status messages', () => {
    mockChatState = {
      ...mockChatState,
      currentConversation: {
        messages: [
          {
            id: 'msg-1',
            role: 'assistant',
            content: 'Processing...',
            messageType: 'status',
            statusType: 'thinking',
          },
        ],
      },
    }

    render(<ChatArea isAuthenticated={true} />)

    // Status messages render inline with the status type
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  test('renders agent prompts', () => {
    mockChatState = {
      ...mockChatState,
      currentConversation: {
        messages: [
          {
            id: 'msg-1',
            role: 'assistant',
            content: 'Please provide more details',
            messageType: 'prompt',
            promptType: 'input',
          },
        ],
      },
    }

    render(<ChatArea isAuthenticated={true} />)

    expect(screen.getByTestId('agent-prompt')).toBeInTheDocument()
  })

  test('renders agent responses', () => {
    mockChatState = {
      ...mockChatState,
      currentConversation: {
        messages: [
          {
            id: 'msg-1',
            role: 'assistant',
            content: 'Here is your answer',
            messageType: 'agent_response',
          },
        ],
      },
    }

    render(<ChatArea isAuthenticated={true} />)

    expect(screen.getByTestId('agent-response')).toHaveTextContent('Here is your answer')
  })

  test('renders file messages', () => {
    mockChatState = {
      ...mockChatState,
      currentConversation: {
        messages: [
          {
            id: 'msg-1',
            role: 'assistant',
            content: '',
            messageType: 'file',
            fileData: {
              fileName: 'document.pdf',
              fileSize: 1024,
              fileStatus: 'success',
            },
          },
        ],
      },
    }

    render(<ChatArea isAuthenticated={true} />)

    // File messages render inline with the file name
    expect(screen.getByText(/document\.pdf/)).toBeInTheDocument()
  })

  test('renders error banners', () => {
    mockChatState = {
      ...mockChatState,
      currentConversation: {
        messages: [
          {
            id: 'msg-1',
            role: 'assistant',
            content: '',
            messageType: 'error',
            errorData: {
              errorCode: 'E001',
              errorMessage: 'Something went wrong',
            },
          },
        ],
      },
    }

    render(<ChatArea isAuthenticated={true} />)

    expect(screen.getByTestId('error-card')).toBeInTheDocument()
  })

  test('does not render assistant messages (full reports)', () => {
    mockChatState = {
      ...mockChatState,
      currentConversation: {
        messages: [
          {
            id: 'msg-1',
            role: 'assistant',
            content: 'Full report content',
            messageType: 'assistant',
          },
        ],
      },
    }

    render(<ChatArea isAuthenticated={true} />)

    // Should show welcome state since assistant messages are filtered out
    expect(screen.getByText('Welcome to AI-Q')).toBeInTheDocument()
  })

  test('renders chat messages area with aria-label', () => {
    render(<ChatArea isAuthenticated={true} />)

    // The Flex component renders with aria-label
    expect(screen.getByLabelText(/chat messages/i)).toBeInTheDocument()
  })

  test('handles null currentConversation', () => {
    mockChatState = {
      ...mockChatState,
      currentConversation: null,
    }

    render(<ChatArea isAuthenticated={true} />)

    // Should render welcome state
    expect(screen.getByText('Welcome to AI-Q')).toBeInTheDocument()
  })

  test('renders file upload banners', () => {
    mockChatState = {
      ...mockChatState,
      currentConversation: {
        messages: [
          {
            id: 'msg-1',
            role: 'assistant',
            content: '',
            messageType: 'file_upload_status',
            fileUploadStatusData: {
              type: 'uploaded',
              fileCount: 2,
            },
          },
        ],
      },
    }

    render(<ChatArea isAuthenticated={true} />)

    expect(screen.getByTestId('file-banner')).toBeInTheDocument()
  })

  test('keeps earlier interrupted thinking state after a later completed turn', () => {
    mockGetThinkingStepsForMessage.mockImplementation((messageId: string) => {
      if (messageId === 'user-1') return [{ id: 'step-1', displayName: 'Step 1' }]
      if (messageId === 'user-2') return [{ id: 'step-2', displayName: 'Step 2' }]
      return []
    })

    mockChatState = {
      ...mockChatState,
      currentConversation: {
        messages: [
          { id: 'user-1', role: 'user', content: 'First question', messageType: 'user' },
          { id: 'user-2', role: 'user', content: 'Second question', messageType: 'user' },
          { id: 'answer-2', role: 'assistant', content: 'Second answer', messageType: 'agent_response' },
        ],
      },
    }

    render(<ChatArea isAuthenticated={true} />)

    expect(mockChatThinking).toHaveBeenCalledTimes(2)

    const firstCallProps = mockChatThinking.mock.calls[0][0] as {
      isInterrupted?: boolean
      isThinking?: boolean
    }
    const secondCallProps = mockChatThinking.mock.calls[1][0] as {
      isInterrupted?: boolean
      isThinking?: boolean
    }

    // First turn has no response before next user message -> interrupted.
    expect(firstCallProps.isInterrupted).toBe(true)
    expect(firstCallProps.isThinking).toBe(false)

    // Second turn has a response -> done (not interrupted).
    expect(secondCallProps.isInterrupted).toBe(false)
    expect(secondCallProps.isThinking).toBe(false)
  })

  test('keeps earlier interrupted thinking state while a new message is actively streaming', () => {
    mockGetThinkingStepsForMessage.mockImplementation((messageId: string) => {
      if (messageId === 'user-1') return [{ id: 'step-1', displayName: 'Step 1' }]
      if (messageId === 'user-2') return [{ id: 'step-2', displayName: 'Step 2' }]
      return []
    })

    mockChatState = {
      ...mockChatState,
      currentConversation: {
        messages: [
          { id: 'user-1', role: 'user', content: 'First question', messageType: 'user' },
          { id: 'user-2', role: 'user', content: 'Second question', messageType: 'user' },
        ],
      },
      isStreaming: true,
      currentUserMessageId: 'user-2',
    }

    render(<ChatArea isAuthenticated={true} />)

    expect(mockChatThinking).toHaveBeenCalledTimes(2)

    const firstCallProps = mockChatThinking.mock.calls[0][0] as {
      isInterrupted?: boolean
      isThinking?: boolean
    }
    const secondCallProps = mockChatThinking.mock.calls[1][0] as {
      isInterrupted?: boolean
      isThinking?: boolean
    }

    // First turn was interrupted — must keep warning icon even while second turn streams.
    expect(firstCallProps.isInterrupted).toBe(true)
    expect(firstCallProps.isThinking).toBe(false)

    // Second turn is actively streaming — shows spinner, not interrupted.
    expect(secondCallProps.isThinking).toBe(true)
    expect(secondCallProps.isInterrupted).toBe(false)
  })
})
