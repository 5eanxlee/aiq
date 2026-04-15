// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * AppBar Component
 *
 * Top navigation bar with sidebar toggle, brand, current project summary,
 * and action buttons (New Chat, Data Sources, Settings, Docs, User Avatar).
 */

'use client'

import { type FC, useCallback, useMemo, useState } from 'react'
import { Flex, Text, Button, Logo, Popover, Divider, Badge, SegmentedControl } from '@/adapters/ui'
import {
  Menu,
  Globe,
  Settings,
  Book,
  Lock,
  Logout,
  ChevronRight,
  Info,
  ChartFlow,
  Sun,
  Moon,
  Plus,
} from '@/adapters/ui/icons'
import { useLayoutStore } from '../store'
import type { ThemeMode } from '../types'

interface AppBarProps {
  /** Current project title to display */
  projectTitle?: string
  /** Current chat title to display */
  chatTitle?: string
  /** Whether the active context is a project */
  isProjectContext?: boolean
  /** Whether the user is authenticated */
  isAuthenticated?: boolean
  /** Whether authentication is required (false = using default user) */
  authRequired?: boolean
  /** User info for avatar */
  user?: {
    name?: string
    email?: string
    image?: string
  }
  /** Callback when a new chat is requested */
  onNewChat?: () => void
  /** Disable creating a new chat while shallow research/HITL is active */
  isNewChatDisabled?: boolean
  /** Callback when sign in is clicked */
  onSignIn?: () => void
  /** Callback when sign out is clicked */
  onSignOut?: () => void
}

const ThemeSelectorContent = ({
  theme,
  onThemeChange,
}: {
  theme: ThemeMode
  onThemeChange: (value: string) => void
}) => (
  <Flex direction="col" gap="3" className="min-w-[220px] p-3">
    <div>
      <Text kind="label/semibold/xs" className="text-subtle uppercase tracking-[0.08em]">
        Theme
      </Text>
      <Text kind="body/regular/xs" className="mt-1 block text-subtle">
        Update the app appearance immediately.
      </Text>
    </div>
    <SegmentedControl
      value={theme}
      onValueChange={onThemeChange}
      size="small"
      className="w-full"
      items={[
        { value: 'light', children: 'Light' },
        { value: 'dark', children: 'Dark' },
        { value: 'system', children: 'System' },
      ]}
    />
  </Flex>
)

const HeaderAvatar = ({
  label,
  imageUrl,
  size = 'small',
}: {
  label: string
  imageUrl?: string
  size?: 'small' | 'medium'
}) => {
  const initial = label.trim().charAt(0).toUpperCase() || 'U'
  const sizeClassName = size === 'medium' ? 'h-10 w-10 text-sm' : 'h-8 w-8 text-xs'

  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden rounded-full border border-base bg-surface-raised text-primary font-semibold ${sizeClassName}`}
    >
      {imageUrl ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="" aria-hidden="true" className="h-full w-full object-cover" />
        </>
      ) : (
        <span aria-hidden="true">{initial}</span>
      )}
      <span className="sr-only">{label}</span>
    </div>
  )
}

export const AppBar: FC<AppBarProps> = ({
  projectTitle,
  chatTitle = 'New Chat',
  isProjectContext = false,
  isAuthenticated = false,
  authRequired = false,
  user,
  onNewChat,
  isNewChatDisabled = false,
  onSignIn,
  onSignOut,
}) => {
  const { toggleSessionsPanel, rightPanel, openRightPanel, closeRightPanel, theme, setTheme } = useLayoutStore()
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false)
  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false)

  const handleMenuClick = useCallback(() => {
    if (!isAuthenticated) return
    toggleSessionsPanel()
  }, [toggleSessionsPanel, isAuthenticated])

  const handleAddSourcesClick = useCallback(() => {
    if (!isAuthenticated) return
    if (rightPanel === 'data-sources') {
      closeRightPanel()
    } else {
      openRightPanel('data-sources')
    }
  }, [rightPanel, openRightPanel, closeRightPanel, isAuthenticated])

  const handleSettingsClick = useCallback(() => {
    if (!isAuthenticated) return
    if (rightPanel === 'settings') {
      closeRightPanel()
    } else {
      openRightPanel('settings')
    }
  }, [rightPanel, openRightPanel, closeRightPanel, isAuthenticated])

  const handleProvidersClick = useCallback(() => {
    if (!isAuthenticated) return
    if (rightPanel === 'providers') {
      closeRightPanel()
    } else {
      openRightPanel('providers')
    }
  }, [rightPanel, openRightPanel, closeRightPanel, isAuthenticated])

  const handleDocsClick = useCallback(() => {
    window.open('https://github.com/NVIDIA-AI-Blueprints/aiq', '_blank')
  }, [])

  const handleThemeChange = useCallback(
    (value: string) => {
      setTheme(value as ThemeMode)
      setIsThemeMenuOpen(false)
    },
    [setTheme]
  )

  const handleNewChatClick = useCallback(() => {
    if (!isAuthenticated || isNewChatDisabled) return
    onNewChat?.()
  }, [isAuthenticated, isNewChatDisabled, onNewChat])

  const handleSignOut = useCallback(() => {
    setIsUserMenuOpen(false)
    onSignOut?.()
  }, [onSignOut])

  const ThemeIcon = useMemo(() => {
    if (theme === 'dark') {
      return Moon
    }
    return Sun
  }, [theme])

  const avatarLabel = user?.name || user?.email || 'User'

  return (
    <header className="border-b border-base">
      <Flex align="center" justify="between" className="h-[var(--header-height)] gap-4 px-4">
        <Flex align="center" gap="3" className="min-w-0 flex-1">
          <Button
            kind="tertiary"
            size="small"
            onClick={handleMenuClick}
            disabled={!isAuthenticated}
            aria-label="Toggle chats sidebar"
            title="Toggle chats sidebar"
          >
            <Menu className="h-4 w-4" />
          </Button>

          <Flex align="center" gap="2" className="shrink-0">
            <Logo kind="logo-only" size="small" />
            <Text kind="label/semibold/lg" className="text-primary whitespace-nowrap">
              AI-Q
            </Text>
          </Flex>

          <Button
            kind="secondary"
            size="small"
            onClick={handleNewChatClick}
            disabled={!isAuthenticated || isNewChatDisabled}
            aria-label="Create new chat"
            title={
              isNewChatDisabled
                ? 'Cannot create a new chat while the current chat is active'
                : 'Create new chat'
            }
          >
            <Flex align="center" gap="1">
              <Plus className="h-4 w-4" />
              <Text kind="label/regular/md">New Chat</Text>
            </Flex>
          </Button>

          {isAuthenticated && isProjectContext && (
            <Flex direction="col" gap="1" className="hidden min-w-0 flex-1 md:flex">
              <Flex align="center" gap="2" className="min-w-0">
                <Badge color="teal">Project</Badge>
                <Text
                  kind="label/semibold/sm"
                  className="block max-w-[320px] truncate text-primary lg:max-w-[420px] xl:max-w-[520px]"
                  title={projectTitle}
                >
                  {projectTitle}
                </Text>
              </Flex>

              <Text
                kind="body/regular/sm"
                className="block w-full max-w-[360px] truncate text-subtle lg:max-w-[480px] xl:max-w-[560px]"
                title={`Chat: ${chatTitle}`}
              >
                {`Chat: ${chatTitle}`}
              </Text>
            </Flex>
          )}
        </Flex>

        <Flex align="center" gap="2" className="shrink-0">
          <Popover
            open={isThemeMenuOpen}
            onOpenChange={setIsThemeMenuOpen}
            side="bottom"
            align="end"
            slotContent={<ThemeSelectorContent theme={theme} onThemeChange={handleThemeChange} />}
          >
            <Button
              kind="tertiary"
              size="small"
              aria-label="Open theme selector"
              title="Open theme selector"
            >
              <Flex align="center" gap="1">
                <ThemeIcon className="h-4 w-4" />
                <Text kind="label/regular/md">Theme</Text>
              </Flex>
            </Button>
          </Popover>

          <Button
            kind="tertiary"
            size="small"
            onClick={handleAddSourcesClick}
            disabled={!isAuthenticated}
            aria-label="Add data sources"
            title="Add data sources"
          >
            <Flex align="center" gap="1">
              <Globe className="h-4 w-4" />
              <Text kind="label/regular/md">Data Sources</Text>
            </Flex>
          </Button>

          <Button
            kind="tertiary"
            size="small"
            onClick={handleProvidersClick}
            disabled={!isAuthenticated}
            aria-label="View providers"
            title="View providers"
          >
            <Flex align="center" gap="1">
              <ChartFlow className="h-4 w-4" />
              <Text kind="label/regular/md">Providers</Text>
            </Flex>
          </Button>

          <Button
            kind="tertiary"
            size="small"
            onClick={handleDocsClick}
            aria-label="View documentation"
            title="View documentation"
          >
            <Flex align="center" gap="1">
              <Book className="h-4 w-4" />
              <Text kind="label/regular/md">Docs</Text>
            </Flex>
          </Button>

          <Button
            kind="tertiary"
            size="small"
            onClick={handleSettingsClick}
            disabled={!isAuthenticated}
            aria-label="Open settings"
            title="Open settings"
          >
            <Flex align="center" gap="1">
              <Settings className="h-4 w-4" />
              <Text kind="label/regular/md">Settings</Text>
            </Flex>
          </Button>

          {!isAuthenticated ? (
            authRequired ? (
              <Button kind="primary" color="brand" size="small" onClick={onSignIn}>
                <Lock className="h-4 w-4" />
                Sign In
              </Button>
            ) : (
              <Popover
                side="bottom"
                align="end"
                slotContent={
                  <Flex direction="col" gap="2" className="max-w-[220px] p-3">
                    <Flex align="center" gap="2">
                      <Info className="text-subtle h-4 w-4" />
                      <Text kind="label/semibold/sm">Authentication Disabled</Text>
                    </Flex>
                    <Text kind="body/regular/sm" className="text-subtle">
                      This app is running without authentication. Your chats stay on this device.
                    </Text>
                  </Flex>
                }
              >
                <div>
                  <HeaderAvatar label="Default User" size="small" />
                </div>
              </Popover>
            )
          ) : (
            <Popover
              open={isUserMenuOpen}
              onOpenChange={setIsUserMenuOpen}
              side="bottom"
              align="end"
              slotContent={
                <Flex direction="col" gap="2" className="min-w-[240px] p-3">
                  <Flex align="center" gap="3">
                    <HeaderAvatar label={avatarLabel} imageUrl={user?.image} size="medium" />
                    <Flex direction="col" gap="0.5" className="min-w-0">
                      <Text kind="label/semibold/sm" className="truncate">
                        {user?.name || 'User'}
                      </Text>
                      {user?.email && (
                        <Text kind="body/regular/xs" className="truncate text-subtle">
                          {user.email}
                        </Text>
                      )}
                    </Flex>
                  </Flex>

                  <Divider />

                  <Button kind="tertiary" size="small" onClick={handleSignOut}>
                    <Flex align="center" justify="between" className="w-full">
                      <Flex align="center" gap="2">
                        <Logout className="h-4 w-4" />
                        <Text kind="label/regular/md">Sign Out</Text>
                      </Flex>
                      <ChevronRight className="h-4 w-4 text-subtle" />
                    </Flex>
                  </Button>
                </Flex>
              }
            >
              <div>
                <HeaderAvatar label={avatarLabel} imageUrl={user?.image} size="small" />
              </div>
            </Popover>
          )}
        </Flex>
      </Flex>
    </header>
  )
}
