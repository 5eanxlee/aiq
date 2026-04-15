// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { render, screen } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { AppBar } from './AppBar'

const mockToggleSessionsPanel = vi.fn()
const mockOpenRightPanel = vi.fn()
const mockCloseRightPanel = vi.fn()
const mockSetTheme = vi.fn()

vi.mock('../store', () => ({
  useLayoutStore: () => ({
    toggleSessionsPanel: mockToggleSessionsPanel,
    rightPanel: null,
    openRightPanel: mockOpenRightPanel,
    closeRightPanel: mockCloseRightPanel,
    theme: 'system',
    setTheme: mockSetTheme,
  }),
}))

describe('AppBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('renders the brand and primary new chat action', () => {
    render(<AppBar isAuthenticated={true} />)

    expect(screen.getByText('AI-Q')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create new chat/i })).toBeInTheDocument()
  })

  test('shows project context only when a project is active', () => {
    const { rerender } = render(<AppBar isAuthenticated={true} chatTitle="Root Chat" />)

    expect(screen.queryByText('Project')).not.toBeInTheDocument()
    expect(screen.queryByText(/chat:\s*root chat/i)).not.toBeInTheDocument()

    rerender(
      <AppBar
        isAuthenticated={true}
        isProjectContext={true}
        projectTitle="Project Atlas"
        chatTitle="Roadmap Draft"
      />
    )

    expect(screen.getByText('Project')).toBeInTheDocument()
    expect(screen.getByText('Project Atlas')).toBeInTheDocument()
    expect(screen.getByText('Chat: Roadmap Draft')).toBeInTheDocument()
  })

  test('disables auth-gated actions while unauthenticated', () => {
    render(<AppBar isAuthenticated={false} authRequired={true} />)

    expect(screen.getByRole('button', { name: /create new chat/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /toggle chats sidebar/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /add data sources/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /view providers/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /open settings/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /open theme selector/i })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })

  test('calls onNewChat when the primary button is clicked', async () => {
    const user = userEvent.setup()
    const onNewChat = vi.fn()

    render(<AppBar isAuthenticated={true} onNewChat={onNewChat} />)

    await user.click(screen.getByRole('button', { name: /create new chat/i }))

    expect(onNewChat).toHaveBeenCalledOnce()
  })

  test('disables new chat when navigation is blocked', () => {
    render(<AppBar isAuthenticated={true} isNewChatDisabled={true} />)

    expect(screen.getByRole('button', { name: /create new chat/i })).toBeDisabled()
  })

  test('toggles the sidebar and right panels', async () => {
    const user = userEvent.setup()

    render(<AppBar isAuthenticated={true} />)

    await user.click(screen.getByRole('button', { name: /toggle chats sidebar/i }))
    await user.click(screen.getByRole('button', { name: /add data sources/i }))
    await user.click(screen.getByRole('button', { name: /view providers/i }))
    await user.click(screen.getByRole('button', { name: /open settings/i }))

    expect(mockToggleSessionsPanel).toHaveBeenCalledOnce()
    expect(mockOpenRightPanel).toHaveBeenCalledWith('data-sources')
    expect(mockOpenRightPanel).toHaveBeenCalledWith('providers')
    expect(mockOpenRightPanel).toHaveBeenCalledWith('settings')
  })

  test('updates the theme from the selector', async () => {
    const user = userEvent.setup()

    render(<AppBar isAuthenticated={true} />)

    await user.click(screen.getByRole('button', { name: /open theme selector/i }))
    await user.click(screen.getByText('Dark'))

    expect(mockSetTheme).toHaveBeenCalledWith('dark')
  })

  test('opens docs in a new tab', async () => {
    const user = userEvent.setup()
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

    render(<AppBar isAuthenticated={true} />)

    await user.click(screen.getByRole('button', { name: /view documentation/i }))

    expect(openSpy).toHaveBeenCalledWith(
      'https://github.com/NVIDIA-AI-Blueprints/aiq',
      '_blank'
    )

    openSpy.mockRestore()
  })
})
