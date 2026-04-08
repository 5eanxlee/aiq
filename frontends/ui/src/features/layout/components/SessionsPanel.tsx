// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * SessionsPanel Component
 *
 * Left panel displaying session history with new session and delete all buttons.
 * Slides in from the left and overlays content.
 */

'use client'

import {
  type FC,
  type KeyboardEvent,
  useCallback,
  useMemo,
  useState,
  useRef,
  useEffect,
} from 'react'
import { Flex, Text, Button, SidePanel } from '@/adapters/ui'
import { Chat, Edit, Trash, Plus, Search, LoadingSpinner } from '@/adapters/ui/icons'
import { useLayoutStore } from '../store'
import { useChatStore } from '@/features/chat'
import { checkStorageHealth } from '@/features/chat/lib/storage-manager'
import { DeleteSessionConfirmationModal } from './DeleteSessionConfirmationModal'
import { DeleteAllSessionsConfirmationModal } from './DeleteAllSessionsConfirmationModal'

interface Session {
  id: string
  title: string
  date: Date
  hasActiveDeepResearch?: boolean
}

interface ProjectItem {
  id: string
  title: string
  date: Date
}

interface SessionsPanelProps {
  /** List of projects to display */
  projects?: ProjectItem[]
  /** Whether standalone scope is selected */
  isStandaloneScope?: boolean
  /** Callback when standalone scope is selected */
  onSelectStandalone?: () => void
  /** Currently selected project ID */
  selectedProjectId?: string
  /** Callback when a project is selected */
  onSelectProject?: (projectId: string) => void
  /** Callback when new project is clicked */
  onNewProject?: () => void
  /** Callback when a project is deleted */
  onDeleteProject?: (projectId: string) => void
  /** Callback when a project is renamed */
  onRenameProject?: (projectId: string, newTitle: string) => void
  /** List of sessions to display */
  sessions?: Session[]
  /** Currently selected session ID */
  selectedSessionId?: string
  /** Callback when a session is selected */
  onSelectSession?: (sessionId: string) => void
  /** Callback when new session is clicked */
  onNewSession?: () => void
  /** Callback when a session is deleted */
  onDeleteSession?: (sessionId: string) => void
  /** Callback when all sessions are deleted */
  onDeleteAllSessions?: () => void
  /** Callback when a session is renamed */
  onRenameSession?: (sessionId: string, newTitle: string) => void
}

/**
 * Sessions panel with history grouped by date.
 * Opens from the left side of the screen.
 */
export const SessionsPanel: FC<SessionsPanelProps> = ({
  projects = [],
  isStandaloneScope = false,
  onSelectStandalone,
  selectedProjectId,
  onSelectProject,
  onNewProject,
  onDeleteProject,
  onRenameProject,
  sessions = [],
  selectedSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onDeleteAllSessions,
  onRenameSession,
}) => {
  const { isSessionsPanelOpen, setSessionsPanelOpen } = useLayoutStore()
  const isSessionBusy = useChatStore((state) => state.isSessionBusy)
  const hasAnyBusySession = useChatStore((state) => state.hasAnyBusySession)

  // Navigation-specific busy check: only shallow thinking (WebSocket) and HITL prompts
  // block session switching. Deep research runs server-side and can be reconnected,
  // so it should NOT prevent navigation.
  const isStreaming = useChatStore((state) => state.isStreaming)
  const hasPendingInteraction = useChatStore((state) => state.pendingInteraction !== null)
  const isNavigationBlocked = isStreaming || hasPendingInteraction
  const [searchQuery, setSearchQuery] = useState('')
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [deleteAllModalOpen, setDeleteAllModalOpen] = useState(false)
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null)

  // Storage usage percentage — refreshes when the panel opens.
  const storagePercent = useMemo(() => {
    if (!isSessionsPanelOpen) return 0
    return Math.round(checkStorageHealth().percentUsed)
  }, [isSessionsPanelOpen])

  // Check if any session has active operations
  const anySessionBusy = hasAnyBusySession()

  const handleDeleteClick = useCallback((sessionId: string) => {
    setSessionToDelete(sessionId)
    setDeleteModalOpen(true)
  }, [])

  const handleConfirmDelete = useCallback(() => {
    if (sessionToDelete) {
      onDeleteSession?.(sessionToDelete)
      setSessionToDelete(null)
    }
  }, [sessionToDelete, onDeleteSession])

  const handleDeleteAllClick = useCallback(() => {
    setDeleteAllModalOpen(true)
  }, [])

  const handleConfirmDeleteAll = useCallback(() => {
    onDeleteAllSessions?.()
  }, [onDeleteAllSessions])

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setSessionsPanelOpen(open)
    },
    [setSessionsPanelOpen]
  )

  const handleClose = useCallback(() => {
    setSessionsPanelOpen(false)
  }, [setSessionsPanelOpen])

  const handleNewSession = useCallback(() => {
    onNewSession?.()
    handleClose()
  }, [onNewSession, handleClose])

  const handleNewProject = useCallback(() => {
    onNewProject?.()
    handleClose()
  }, [onNewProject, handleClose])

  const handleProjectClick = useCallback(
    (projectId: string) => {
      onSelectProject?.(projectId)
      handleClose()
    },
    [onSelectProject, handleClose]
  )

  const handleStandaloneClick = useCallback(() => {
    onSelectStandalone?.()
    handleClose()
  }, [handleClose, onSelectStandalone])

  const handleSessionClick = useCallback(
    (sessionId: string) => {
      onSelectSession?.(sessionId)
      handleClose()
    },
    [onSelectSession, handleClose]
  )

  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return sessions
    const query = searchQuery.toLowerCase()
    return sessions.filter((s) => s.title.toLowerCase().includes(query))
  }, [sessions, searchQuery])

  // Group sessions by date
  const groupedSessions = groupSessionsByDate(filteredSessions)
  const scopeDeleteLabel = isStandaloneScope ? 'Delete Chats' : 'Delete Sessions'
  const scopeDeleteTitle = isStandaloneScope
    ? 'Delete all standalone chats'
    : 'Delete all sessions in this project'
  const newSessionLabel = isStandaloneScope ? 'New Chat' : 'New Session'
  const newSessionTitle = isStandaloneScope
    ? 'Start new standalone chat'
    : 'Start new session'
  const emptyStateLabel = searchQuery.trim()
    ? 'No matching sessions'
    : isStandaloneScope
      ? 'No standalone chats yet'
      : 'No sessions yet'
  const emptyStateActionLabel = isStandaloneScope ? 'Start a new chat' : 'Start a new session'

  return (
    <SidePanel
      className="bg-surface-base top-[var(--header-height)] h-[calc(100vh-var(--header-height))] w-[406px] rounded-r-2xl"
      open={isSessionsPanelOpen}
      onOpenChange={handleOpenChange}
      side="left"
      bordered
      closeOnClickOutside={false}
      forceMount
      slotHeading={
        <Flex align="center" gap="2">
          <Chat />
          Sessions
        </Flex>
      }
      slotFooter={
        <Flex direction="col" gap="1">
          <Text kind="body/regular/xs" className="text-subtle">
            Using {storagePercent}% of browser storage quota
          </Text>
          <Text kind="body/regular/xs" className="text-subtle">
            Note: Sessions and files are saved for a limited time before automatic deletion.
          </Text>
        </Flex>
      }
    >
      {/* Scope actions */}
      <Flex align="center" justify="between" gap="2" className="mb-4">
        <Button
          kind="tertiary"
          size="small"
          color="danger"
          onClick={handleDeleteAllClick}
          disabled={anySessionBusy}
          aria-label={
            anySessionBusy
              ? `${scopeDeleteLabel} (disabled during active operations)`
              : scopeDeleteLabel
          }
          title={
            anySessionBusy
              ? 'Cannot delete while operations are in progress'
              : scopeDeleteTitle
          }
        >
          <Flex align="center" gap="1">
            <Trash className="h-4 w-4" />
            <Text kind="label/regular/sm">{scopeDeleteLabel}</Text>
          </Flex>
        </Button>
        <Flex align="center" gap="2">
          <Button
            kind="tertiary"
            size="small"
            onClick={handleNewProject}
            disabled={isNavigationBlocked}
            aria-label={
              isNavigationBlocked
                ? 'Start new project (disabled during active operations)'
                : 'Start new project'
            }
            title={
              isNavigationBlocked
                ? 'Cannot create a new project while the current session is active'
                : 'Start new project'
            }
          >
            <Flex align="center" gap="1">
              <Plus className="h-4 w-4" />
              <Text kind="label/regular/sm">New Project</Text>
            </Flex>
          </Button>
          <Button
            kind="tertiary"
            size="small"
            onClick={handleNewSession}
            disabled={isNavigationBlocked}
            aria-label={
              isNavigationBlocked
                ? `${newSessionTitle} (disabled during active operations)`
                : newSessionTitle
            }
            title={
              isNavigationBlocked
                ? 'Cannot create new session while current session is active'
                : newSessionTitle
            }
          >
            <Flex align="center" gap="1">
              <Plus className="h-4 w-4" />
              <Text kind="label/regular/sm">{newSessionLabel}</Text>
            </Flex>
          </Button>
        </Flex>
      </Flex>

      {/* Scope */}
      <Flex direction="col" gap="2" className="mb-4">
        <Text kind="label/semibold/xs" className="text-subtle uppercase">
          Chat Scope
        </Text>
        <ScopeRow
          label="Standalone Chat"
          description="No shared project files"
          isSelected={isStandaloneScope}
          isBusy={isNavigationBlocked}
          onSelect={handleStandaloneClick}
        />
      </Flex>

      {/* Projects */}
      <Flex direction="col" gap="2" className="mb-4">
        <Text kind="label/semibold/xs" className="text-subtle uppercase">
          Projects
        </Text>
        {projects.map((project) => (
          <ProjectRow
            key={project.id}
            project={project}
            isSelected={selectedProjectId === project.id}
            isBusy={isNavigationBlocked}
            isMutating={anySessionBusy}
            onSelect={handleProjectClick}
            onDelete={onDeleteProject}
            onRename={onRenameProject}
          />
        ))}
      </Flex>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="text-subtle pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search sessions..."
          className="bg-surface-base border-base text-primary placeholder:text-subtle focus:border-accent-primary h-9 w-full rounded-md border pl-8 pr-3 text-sm outline-none"
          aria-label="Search sessions"
        />
      </div>

      {/* Session List */}
      <Flex direction="col" className="flex-1 overflow-y-auto">
        {Object.entries(groupedSessions).map(([dateLabel, dateSessions]) => (
          <Flex key={dateLabel} direction="col" gap="2" className="mb-4">
            <Text kind="label/semibold/xs" className="text-subtle uppercase">
              {dateLabel}
            </Text>
            {dateSessions.map((session) => (
              <SessionItem
                key={session.id}
                session={session}
                isSelected={selectedSessionId === session.id}
                isBusy={isNavigationBlocked}
                isSessionActive={isSessionBusy(session.id)}
                onSelect={handleSessionClick}
                onDelete={handleDeleteClick}
                onRename={onRenameSession}
              />
            ))}
          </Flex>
        ))}

        {filteredSessions.length === 0 && (
          <Flex direction="col" align="center" justify="center" className="flex-1 py-8">
            <Text kind="body/regular/sm" className="text-subtle">
              {emptyStateLabel}
            </Text>
            {!searchQuery.trim() && (
              <Button kind="secondary" size="small" onClick={handleNewSession} className="mt-4">
                {emptyStateActionLabel}
              </Button>
            )}
          </Flex>
        )}
      </Flex>

      <DeleteSessionConfirmationModal
        open={deleteModalOpen}
        onOpenChange={setDeleteModalOpen}
        onConfirm={handleConfirmDelete}
      />

      <DeleteAllSessionsConfirmationModal
        open={deleteAllModalOpen}
        onOpenChange={setDeleteAllModalOpen}
        onConfirm={handleConfirmDeleteAll}
      />
    </SidePanel>
  )
}

/**
 * SessionItem Component
 *
 * Individual session item with hover-reveal edit/delete icons and inline rename.
 */
interface SessionItemProps {
  session: Session
  isSelected: boolean
  /** Navigation block: true when shallow thinking (WS) or HITL prompt is pending.
   *  Deep research does NOT block navigation since it runs server-side. */
  isBusy?: boolean
  /** Per-session block: true when this specific session has active deep research */
  isSessionActive?: boolean
  onSelect?: (sessionId: string) => void
  onDelete?: (sessionId: string) => void
  onRename?: (sessionId: string, newTitle: string) => void
}

interface ProjectRowProps {
  project: ProjectItem
  isSelected: boolean
  isBusy?: boolean
  isMutating?: boolean
  onSelect?: (projectId: string) => void
  onDelete?: (projectId: string) => void
  onRename?: (projectId: string, newTitle: string) => void
}

interface ScopeRowProps {
  label: string
  description?: string
  isSelected: boolean
  isBusy?: boolean
  onSelect?: () => void
}

const ScopeRow: FC<ScopeRowProps> = ({
  label,
  description,
  isSelected,
  isBusy = false,
  onSelect,
}) => {
  const handleSelect = useCallback(() => {
    if (!isBusy) {
      onSelect?.()
    }
  }, [isBusy, onSelect])

  return (
    <div
      role="button"
      tabIndex={isBusy ? -1 : 0}
      onClick={handleSelect}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !isBusy) {
          e.preventDefault()
          handleSelect()
        }
      }}
      aria-label={`${label}${description ? ` (${description})` : ''}`}
      className={`
        focus-visible:ring-brand flex min-h-10 w-full items-center rounded-md border p-2 text-left
        outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset
        ${isBusy ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}
        ${
          isSelected
            ? 'bg-surface-raised border-accent-primary border'
            : 'border-base hover:bg-surface-raised-50 bg-transparent'
        }
      `}
    >
      <Flex direction="col" gap="1" className="min-w-0 flex-1">
        <Text kind="body/regular/sm" className="text-primary truncate">
          {label}
        </Text>
        {description && (
          <Text kind="body/regular/xs" className="text-subtle truncate">
            {description}
          </Text>
        )}
      </Flex>
    </div>
  )
}

const ProjectRow: FC<ProjectRowProps> = ({
  project,
  isSelected,
  isBusy = false,
  isMutating = false,
  onSelect,
  onDelete,
  onRename,
}) => {
  const [isHovered, setIsHovered] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(project.title)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleClick = useCallback(() => {
    if (!isEditing && !isBusy) {
      onSelect?.(project.id)
    }
  }, [isEditing, isBusy, onSelect, project.id])

  const handleSaveRename = useCallback(() => {
    const trimmedValue = editValue.trim()
    if (trimmedValue && trimmedValue !== project.title) {
      onRename?.(project.id, trimmedValue)
    }
    setIsEditing(false)
  }, [editValue, onRename, project.id, project.title])

  return (
    <div
      role="button"
      tabIndex={isBusy ? -1 : 0}
      onClick={handleClick}
      onKeyDown={(e) => e.key === 'Enter' && !isEditing && !isBusy && handleClick()}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`
        focus-visible:ring-brand group flex h-10 w-full items-center gap-2
        rounded-md border p-2 text-left
        outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset
        ${isBusy ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}
        ${
          isSelected
            ? 'bg-surface-raised border-accent-primary border'
            : 'border-base hover:bg-surface-raised-50 bg-transparent'
        }
      `}
    >
      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleSaveRename()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setEditValue(project.title)
              setIsEditing(false)
            }
          }}
          onBlur={handleSaveRename}
          onClick={(e) => e.stopPropagation()}
          className="
            bg-surface-base border-accent-primary text-primary h-8 min-w-0 flex-1 rounded border
            px-2 py-1 text-sm outline-none
          "
          aria-label="Edit project title"
        />
      ) : (
        <>
          <Text kind="body/regular/sm" className="text-primary min-w-0 flex-1 truncate">
            {project.title}
          </Text>
          {isHovered && (
            <Flex align="center" gap="1" className="shrink-0">
              <Button
                kind="tertiary"
                size="tiny"
                onClick={(e) => {
                  e.stopPropagation()
                  setEditValue(project.title)
                  setIsEditing(true)
                }}
                disabled={isBusy || isMutating}
                aria-label="Rename project"
              >
                <Edit height={16} width={16} />
              </Button>
              <Button
                kind="tertiary"
                size="tiny"
                color="danger"
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete?.(project.id)
                }}
                disabled={isBusy || isMutating}
                aria-label="Delete project"
              >
                <Trash height={16} width={16} />
              </Button>
            </Flex>
          )}
        </>
      )}
    </div>
  )
}

const SessionItem: FC<SessionItemProps> = ({
  session,
  isSelected,
  isBusy = false,
  isSessionActive = false,
  onSelect,
  onDelete,
  onRename,
}) => {
  const [isHovered, setIsHovered] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(session.title)
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleClick = useCallback(() => {
    if (!isEditing && !isBusy) {
      onSelect?.(session.id)
    }
  }, [isEditing, isBusy, onSelect, session.id])

  const handleEditClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      setEditValue(session.title)
      setIsEditing(true)
    },
    [session.title]
  )

  const handleDeleteClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onDelete?.(session.id)
    },
    [onDelete, session.id]
  )

  const handleSaveRename = useCallback(() => {
    const trimmedValue = editValue.trim()
    if (trimmedValue && trimmedValue !== session.title) {
      onRename?.(session.id, trimmedValue)
    }
    setIsEditing(false)
  }, [editValue, session.id, session.title, onRename])

  const handleCancelRename = useCallback(() => {
    setEditValue(session.title)
    setIsEditing(false)
  }, [session.title])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleSaveRename()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        handleCancelRename()
      }
    },
    [handleSaveRename, handleCancelRename]
  )

  const handleInputBlur = useCallback(() => {
    handleSaveRename()
  }, [handleSaveRename])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setEditValue(e.target.value)
  }, [])

  return (
    <div
      role="button"
      tabIndex={isBusy ? -1 : 0}
      onClick={handleClick}
      onKeyDown={(e) => e.key === 'Enter' && !isEditing && !isBusy && handleClick()}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`
        focus-visible:ring-brand group flex h-10 w-full items-center gap-2
        rounded-md border p-2 text-left
        outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset
        ${isBusy ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}
        ${
          isSelected
            ? 'bg-surface-raised border-accent-primary border'
            : 'border-base hover:bg-surface-raised-50 bg-transparent'
        }
      `}
      aria-label={
        isBusy ? `Session: ${session.title} (processing in progress)` : `Session: ${session.title}`
      }
      aria-disabled={isBusy}
    >
      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onBlur={handleInputBlur}
          onClick={(e) => e.stopPropagation()}
          className="
            bg-surface-base border-accent-primary text-primary h-8 min-w-0 flex-1 rounded border
            px-2 py-1 text-sm outline-none
          "
          aria-label="Edit session title"
        />
      ) : (
        <>
          {/* Loading indicator for active deep research */}
          {session.hasActiveDeepResearch && (
            <LoadingSpinner
              className="text-accent-primary shrink-0"
              aria-label="Deep research in progress"
            />
          )}

          <Text kind="body/regular/sm" className="text-primary min-w-0 flex-1 truncate">
            {session.title}
          </Text>

          {/* Action icons - shown on hover */}
          {isHovered && (
            <Flex align="center" gap="1" className="shrink-0">
              <Button
                kind="tertiary"
                size="tiny"
                onClick={handleEditClick}
                disabled={isBusy || isSessionActive}
                aria-label={
                  isBusy || isSessionActive ? 'Rename session (disabled)' : 'Rename session'
                }
                title={
                  isBusy || isSessionActive
                    ? 'Cannot rename while operations are in progress'
                    : 'Rename session'
                }
              >
                <Edit height={16} width={16} />
              </Button>
              <Button
                kind="tertiary"
                size="tiny"
                color="danger"
                onClick={handleDeleteClick}
                disabled={isBusy || isSessionActive}
                aria-label={
                  isBusy || isSessionActive ? 'Delete session (disabled)' : 'Delete session'
                }
                title={
                  isBusy || isSessionActive
                    ? 'Cannot delete while operations are in progress'
                    : 'Delete session'
                }
              >
                <Trash height={16} width={16} />
              </Button>
            </Flex>
          )}
        </>
      )}
    </div>
  )
}

/**
 * Groups sessions by relative date labels (Today, Yesterday, or date string)
 */
const groupSessionsByDate = (sessions: Session[]): Record<string, Session[]> => {
  const groups: Record<string, Session[]> = {}
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  for (const session of sessions) {
    const sessionDate = new Date(session.date)
    let label: string

    if (isSameDay(sessionDate, today)) {
      label = 'Today'
    } else if (isSameDay(sessionDate, yesterday)) {
      label = 'Yesterday'
    } else {
      label = sessionDate.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    }

    if (!groups[label]) {
      groups[label] = []
    }
    groups[label].push(session)
  }

  return groups
}

const isSameDay = (d1: Date, d2: Date): boolean => {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  )
}
