// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * SessionsPanel Component
 *
 * Left sidebar displaying chats and projects. In project mode the panel
 * switches to a ChatGPT-style `Chats | Sources` split.
 */

'use client'

import {
  type FC,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Flex, Text, Button, SidePanel, SegmentedControl } from '@/adapters/ui'
import {
  Chat,
  Close,
  Edit,
  Trash,
  Plus,
  Search,
  LoadingSpinner,
  ChevronLeft,
} from '@/adapters/ui/icons'
import { useLayoutStore } from '../store'
import { useChatStore } from '@/features/chat'
import { checkStorageHealth } from '@/features/chat/lib/storage-manager'
import { DeleteSessionConfirmationModal } from './DeleteSessionConfirmationModal'
import { DeleteAllSessionsConfirmationModal } from './DeleteAllSessionsConfirmationModal'
import { FileSourcesTab } from './FileSourcesTab'

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
  /** Currently selected project ID */
  selectedProjectId?: string
  /** Callback when returning to the root chats view */
  onSelectRoot?: () => void
  /** Callback when a project is selected */
  onSelectProject?: (projectId: string) => void
  /** Callback when new project is clicked */
  onNewProject?: () => void
  /** Callback when a project is deleted */
  onDeleteProject?: (projectId: string) => void
  /** Callback when a project is renamed */
  onRenameProject?: (projectId: string, newTitle: string) => void
  /** List of chats to display for the active context */
  sessions?: Session[]
  /** Currently selected chat ID */
  selectedSessionId?: string
  /** Callback when a chat is selected */
  onSelectSession?: (sessionId: string) => void
  /** Callback when new chat is clicked */
  onNewSession?: () => void
  /** Callback when a chat is deleted */
  onDeleteSession?: (sessionId: string) => void
  /** Callback when all chats are deleted */
  onDeleteAllSessions?: () => void
  /** Callback when a chat is renamed */
  onRenameSession?: (sessionId: string, newTitle: string) => void
}

export const SessionsPanel: FC<SessionsPanelProps> = ({
  projects = [],
  selectedProjectId,
  onSelectRoot,
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
  const isSessionsPanelOpen = useLayoutStore((state) => state.isSessionsPanelOpen)
  const setSessionsPanelOpen = useLayoutStore((state) => state.setSessionsPanelOpen)
  const isSessionBusy = useChatStore((state) => state.isSessionBusy)
  const hasAnyBusySession = useChatStore((state) => state.hasAnyBusySession)
  const isStreaming = useChatStore((state) => state.isStreaming)
  const hasPendingInteraction = useChatStore((state) => state.pendingInteraction !== null)

  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [deleteAllModalOpen, setDeleteAllModalOpen] = useState(false)
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null)

  const isProjectMode = Boolean(selectedProjectId)
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  )
  const isNavigationBlocked = isStreaming || hasPendingInteraction

  const storagePercent = useMemo(() => {
    if (!isSessionsPanelOpen) return 0
    return Math.round(checkStorageHealth().percentUsed)
  }, [isSessionsPanelOpen])

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
  }, [onDeleteSession, sessionToDelete])

  const handleDeleteAllClick = useCallback(() => {
    setDeleteAllModalOpen(true)
  }, [])

  const handleConfirmDeleteAll = useCallback(() => {
    onDeleteAllSessions?.()
  }, [onDeleteAllSessions])

  const handleClose = useCallback(() => {
    setSessionsPanelOpen(false)
  }, [setSessionsPanelOpen])

  const handleNewChat = useCallback(() => {
    onNewSession?.()
    handleClose()
  }, [handleClose, onNewSession])

  const handleNewProject = useCallback(() => {
    onNewProject?.()
    handleClose()
  }, [handleClose, onNewProject])

  const handleProjectClick = useCallback(
    (projectId: string) => {
      onSelectProject?.(projectId)
    },
    [onSelectProject]
  )

  const handleBackToRoot = useCallback(() => {
    onSelectRoot?.()
  }, [onSelectRoot])

  const handleChatClick = useCallback(
    (sessionId: string) => {
      onSelectSession?.(sessionId)
      handleClose()
    },
    [handleClose, onSelectSession]
  )

  return (
    <SidePanel
      className="bg-surface-base top-[var(--header-height)] h-[calc(100vh-var(--header-height))] w-[320px] rounded-r-2xl"
      open={isSessionsPanelOpen}
      side="left"
      bordered
      hideCloseButton
      closeOnClickOutside={false}
      onEscapeKeyDown={(event) => {
        event.preventDefault()
        handleClose()
      }}
      slotHeading={
        <Flex align="center" justify="between" gap="2" className="w-full">
          <Flex align="center" gap="2">
            <Chat />
            Chats
          </Flex>
          <Button
            kind="tertiary"
            size="tiny"
            onClick={handleClose}
            aria-label="Close chats sidebar"
            title="Close chats sidebar"
          >
            <Close className="h-4 w-4" />
          </Button>
        </Flex>
      }
      slotFooter={
        <Flex direction="col" gap="1">
          <Text kind="body/regular/xs" className="text-subtle">
            Using {storagePercent}% of browser storage quota
          </Text>
          <Text kind="body/regular/xs" className="text-subtle">
            Chats and files are saved for a limited time before automatic deletion.
          </Text>
        </Flex>
      }
    >
      {isProjectMode ? (
        <ProjectModeView
          projectTitle={selectedProject?.title ?? 'Project'}
          sessions={sessions}
          selectedSessionId={selectedSessionId}
          isNavigationBlocked={isNavigationBlocked}
          anySessionBusy={anySessionBusy}
          onBackToRoot={handleBackToRoot}
          onDeleteAllChats={handleDeleteAllClick}
          onNewChat={handleNewChat}
          onSelectChat={handleChatClick}
          onDeleteChat={handleDeleteClick}
          onRenameChat={onRenameSession}
          isSessionBusy={isSessionBusy}
        />
      ) : (
        <RootModeView
          projects={projects}
          sessions={sessions}
          selectedSessionId={selectedSessionId}
          isNavigationBlocked={isNavigationBlocked}
          anySessionBusy={anySessionBusy}
          onDeleteAllChats={handleDeleteAllClick}
          onNewProject={handleNewProject}
          onNewChat={handleNewChat}
          onSelectChat={handleChatClick}
          onDeleteChat={handleDeleteClick}
          onRenameChat={onRenameSession}
          onSelectProject={handleProjectClick}
          onDeleteProject={onDeleteProject}
          onRenameProject={onRenameProject}
          isSessionBusy={isSessionBusy}
        />
      )}

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

interface RootModeViewProps {
  projects: ProjectItem[]
  sessions: Session[]
  selectedSessionId?: string
  isNavigationBlocked: boolean
  anySessionBusy: boolean
  onDeleteAllChats: () => void
  onNewProject: () => void
  onNewChat: () => void
  onSelectChat: (sessionId: string) => void
  onDeleteChat: (sessionId: string) => void
  onRenameChat?: (sessionId: string, newTitle: string) => void
  onSelectProject: (projectId: string) => void
  onDeleteProject?: (projectId: string) => void
  onRenameProject?: (projectId: string, newTitle: string) => void
  isSessionBusy: (conversationId: string) => boolean
}

const RootModeView: FC<RootModeViewProps> = ({
  projects,
  sessions,
  selectedSessionId,
  isNavigationBlocked,
  anySessionBusy,
  onDeleteAllChats,
  onNewProject,
  onNewChat,
  onSelectChat,
  onDeleteChat,
  onRenameChat,
  onSelectProject,
  onDeleteProject,
  onRenameProject,
  isSessionBusy,
}) => {
  const [searchQuery, setSearchQuery] = useState('')
  const filteredSessions = useMemo(() => filterSessions(sessions, searchQuery), [sessions, searchQuery])
  const groupedSessions = useMemo(
    () => groupSessionsByDate(filteredSessions),
    [filteredSessions]
  )
  const emptyStateLabel = searchQuery.trim() ? 'No matching chats' : 'No chats yet'

  return (
    <Flex direction="col" className="h-full">
      <Flex direction="col" gap="2" className="mb-4">
        <Button
          kind="primary"
          color="brand"
          size="small"
          onClick={onNewChat}
          disabled={isNavigationBlocked}
          className="w-full"
          title={
            isNavigationBlocked
              ? 'Cannot create a new chat while the current chat is active'
              : 'New chat'
          }
        >
          <Flex align="center" justify="center" gap="1" className="w-full">
            <Plus className="h-4 w-4" />
            <Text kind="label/regular/sm">New Chat</Text>
          </Flex>
        </Button>

        <Button
          kind="tertiary"
          size="small"
          onClick={onNewProject}
          disabled={isNavigationBlocked}
          className="w-full"
          title={
            isNavigationBlocked
              ? 'Cannot create a project while the current chat is active'
              : 'New project'
          }
        >
          <Flex align="center" justify="center" gap="1" className="w-full">
            <Plus className="h-4 w-4" />
            <Text kind="label/regular/sm">New Project</Text>
          </Flex>
        </Button>

        <Button
          kind="tertiary"
          size="small"
          color="danger"
          onClick={onDeleteAllChats}
          disabled={anySessionBusy}
          className="w-full"
          aria-label={
            anySessionBusy ? 'Delete chats (disabled during active operations)' : 'Delete chats'
          }
          title={
            anySessionBusy
              ? 'Cannot delete chats while operations are in progress'
              : 'Delete chats'
          }
        >
          <Flex align="center" justify="center" gap="1" className="w-full">
            <Trash className="h-4 w-4" />
            <Text kind="label/regular/sm">Delete Chats</Text>
          </Flex>
        </Button>
      </Flex>

      <SearchInput
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder="Search chats..."
        ariaLabel="Search chats"
      />

      <Flex direction="col" gap="4" className="flex-1 min-h-0 overflow-y-auto">
        <SectionHeader label="Chats" count={filteredSessions.length} />
        <ChatList
          groupedSessions={groupedSessions}
          filteredSessions={filteredSessions}
          selectedSessionId={selectedSessionId}
          isNavigationBlocked={isNavigationBlocked}
          emptyStateLabel={emptyStateLabel}
          emptyStateActionLabel="Start a new chat"
          onNewChat={onNewChat}
          onSelectChat={onSelectChat}
          onDeleteChat={onDeleteChat}
          onRenameChat={onRenameChat}
          isSessionBusy={isSessionBusy}
        />

        <Flex direction="col" gap="2" className="pb-2">
          <SectionHeader label="Projects" count={projects.length} />
          {projects.map((project) => (
            <ProjectRow
              key={project.id}
              project={project}
              isSelected={false}
              isBusy={isNavigationBlocked}
              isMutating={anySessionBusy}
              onSelect={onSelectProject}
              onDelete={onDeleteProject}
              onRename={onRenameProject}
            />
          ))}
        </Flex>
      </Flex>
    </Flex>
  )
}

interface ProjectModeViewProps {
  projectTitle: string
  sessions: Session[]
  selectedSessionId?: string
  isNavigationBlocked: boolean
  anySessionBusy: boolean
  onBackToRoot: () => void
  onDeleteAllChats: () => void
  onNewChat: () => void
  onSelectChat: (sessionId: string) => void
  onDeleteChat: (sessionId: string) => void
  onRenameChat?: (sessionId: string, newTitle: string) => void
  isSessionBusy: (conversationId: string) => boolean
}

const ProjectModeView: FC<ProjectModeViewProps> = ({
  projectTitle,
  sessions,
  selectedSessionId,
  isNavigationBlocked,
  anySessionBusy,
  onBackToRoot,
  onDeleteAllChats,
  onNewChat,
  onSelectChat,
  onDeleteChat,
  onRenameChat,
  isSessionBusy,
}) => {
  const [projectView, setProjectView] = useState<'chats' | 'sources'>('chats')
  const [searchQuery, setSearchQuery] = useState('')
  const filteredSessions = useMemo(() => filterSessions(sessions, searchQuery), [sessions, searchQuery])
  const groupedSessions = useMemo(
    () => groupSessionsByDate(filteredSessions),
    [filteredSessions]
  )
  const emptyStateLabel = searchQuery.trim()
    ? 'No matching chats'
    : 'No chats in this project yet'

  return (
    <Flex direction="col" className="h-full">
      <Flex align="center" gap="2" className="mb-4">
        <Button kind="tertiary" size="small" onClick={onBackToRoot} title="Back to chats">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Flex direction="col" gap="0.5" className="min-w-0 flex-1">
          <Text kind="label/semibold/sm" className="truncate text-primary" title={projectTitle}>
            {projectTitle}
          </Text>
          <Text kind="body/regular/xs" className="text-subtle">
            Project
          </Text>
        </Flex>
      </Flex>

    <SegmentedControl
      value={projectView}
      onValueChange={(value) => setProjectView(value as 'chats' | 'sources')}
        size="small"
        className="mb-4 w-full"
        items={[
          { value: 'chats', children: 'Chats' },
          { value: 'sources', children: 'Sources' },
        ]}
      />

      {projectView === 'sources' ? (
        <FileSourcesTab />
      ) : (
        <Flex direction="col" className="flex-1 min-h-0">
          <Flex direction="col" gap="2" className="mb-4">
            <Button
              kind="primary"
              color="brand"
              size="small"
              onClick={onNewChat}
              disabled={isNavigationBlocked}
              className="w-full"
              title={
                isNavigationBlocked
                  ? 'Cannot create a new chat while the current chat is active'
                  : 'New chat in this project'
              }
            >
              <Flex align="center" justify="center" gap="1" className="w-full">
                <Plus className="h-4 w-4" />
                <Text kind="label/regular/sm">New Chat</Text>
              </Flex>
            </Button>

            <Button
              kind="tertiary"
              size="small"
              color="danger"
              onClick={onDeleteAllChats}
              disabled={anySessionBusy}
              className="w-full"
              title={
                anySessionBusy
                  ? 'Cannot delete chats while operations are in progress'
                  : 'Delete chats in this project'
              }
            >
              <Flex align="center" justify="center" gap="1" className="w-full">
                <Trash className="h-4 w-4" />
                <Text kind="label/regular/sm">Delete Chats</Text>
              </Flex>
            </Button>
          </Flex>

          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search project chats..."
            ariaLabel="Search project chats"
          />

          <SectionHeader label="Chats" count={filteredSessions.length} />
          <ChatList
            groupedSessions={groupedSessions}
            filteredSessions={filteredSessions}
            selectedSessionId={selectedSessionId}
            isNavigationBlocked={isNavigationBlocked}
            emptyStateLabel={emptyStateLabel}
            emptyStateActionLabel="Start a project chat"
            onNewChat={onNewChat}
            onSelectChat={onSelectChat}
            onDeleteChat={onDeleteChat}
            onRenameChat={onRenameChat}
            isSessionBusy={isSessionBusy}
          />
        </Flex>
      )}
    </Flex>
  )
}

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder: string
  ariaLabel: string
}

const SearchInput: FC<SearchInputProps> = ({ value, onChange, placeholder, ariaLabel }) => (
  <div className="relative mb-4">
    <Search className="text-subtle pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2" />
    <input
      type="text"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="bg-surface-base border-base text-primary placeholder:text-subtle focus:border-accent-primary h-9 w-full rounded-md border pl-8 pr-3 text-sm outline-none"
      aria-label={ariaLabel}
    />
  </div>
)

const SectionHeader: FC<{ label: string; count?: number }> = ({ label, count }) => (
  <Flex align="center" gap="2">
    <Text kind="label/semibold/xs" className="text-subtle uppercase">
      {label}
    </Text>
    {typeof count === 'number' && (
      <Text kind="body/regular/xs" className="text-subtle">
        {count}
      </Text>
    )}
  </Flex>
)

interface ChatListProps {
  groupedSessions: Record<string, Session[]>
  filteredSessions: Session[]
  selectedSessionId?: string
  isNavigationBlocked: boolean
  emptyStateLabel: string
  emptyStateActionLabel: string
  onNewChat: () => void
  onSelectChat: (sessionId: string) => void
  onDeleteChat: (sessionId: string) => void
  onRenameChat?: (sessionId: string, newTitle: string) => void
  isSessionBusy: (conversationId: string) => boolean
}

const ChatList: FC<ChatListProps> = ({
  groupedSessions,
  filteredSessions,
  selectedSessionId,
  isNavigationBlocked,
  emptyStateLabel,
  emptyStateActionLabel,
  onNewChat,
  onSelectChat,
  onDeleteChat,
  onRenameChat,
  isSessionBusy,
}) => (
  <Flex direction="col" className="flex-1 min-h-0 overflow-y-auto">
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
            onSelect={onSelectChat}
            onDelete={onDeleteChat}
            onRename={onRenameChat}
          />
        ))}
      </Flex>
    ))}

    {filteredSessions.length === 0 && (
      <Flex direction="col" align="center" justify="center" className="flex-1 py-8 text-center">
        <Text kind="body/regular/sm" className="text-subtle">
          {emptyStateLabel}
        </Text>
        <Button kind="secondary" size="small" onClick={onNewChat} className="mt-4">
          {emptyStateActionLabel}
        </Button>
      </Flex>
    )}
  </Flex>
)

interface ProjectRowProps {
  project: ProjectItem
  isSelected: boolean
  isBusy?: boolean
  isMutating?: boolean
  onSelect?: (projectId: string) => void
  onDelete?: (projectId: string) => void
  onRename?: (projectId: string, newTitle: string) => void
}

interface SessionItemProps {
  session: Session
  isSelected: boolean
  isBusy?: boolean
  isSessionActive?: boolean
  onSelect?: (sessionId: string) => void
  onDelete?: (sessionId: string) => void
  onRename?: (sessionId: string, newTitle: string) => void
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
      onKeyDown={(event) => event.key === 'Enter' && !isEditing && !isBusy && handleClick()}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`
        focus-visible:ring-brand group flex h-10 w-full items-center gap-2 rounded-md border p-2 text-left
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
          onChange={(event) => setEditValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              handleSaveRename()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              setEditValue(project.title)
              setIsEditing(false)
            }
          }}
          onBlur={handleSaveRename}
          onClick={(event) => event.stopPropagation()}
          className="bg-surface-base border-accent-primary text-primary h-8 min-w-0 flex-1 rounded border px-2 py-1 text-sm outline-none"
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
                onClick={(event) => {
                  event.stopPropagation()
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
                onClick={(event) => {
                  event.stopPropagation()
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

  const handleSaveRename = useCallback(() => {
    const trimmedValue = editValue.trim()
    if (trimmedValue && trimmedValue !== session.title) {
      onRename?.(session.id, trimmedValue)
    }
    setIsEditing(false)
  }, [editValue, onRename, session.id, session.title])

  const handleCancelRename = useCallback(() => {
    setEditValue(session.title)
    setIsEditing(false)
  }, [session.title])

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        handleSaveRename()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        handleCancelRename()
      }
    },
    [handleCancelRename, handleSaveRename]
  )

  return (
    <div
      role="button"
      tabIndex={isBusy ? -1 : 0}
      onClick={handleClick}
      onKeyDown={(event) => event.key === 'Enter' && !isEditing && !isBusy && handleClick()}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`
        focus-visible:ring-brand group flex h-10 w-full items-center gap-2 rounded-md border p-2 text-left
        outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset
        ${isBusy ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}
        ${
          isSelected
            ? 'bg-surface-raised border-accent-primary border'
            : 'border-base hover:bg-surface-raised-50 bg-transparent'
        }
      `}
      aria-label={isBusy ? `Chat: ${session.title} (processing in progress)` : `Chat: ${session.title}`}
      aria-disabled={isBusy}
    >
      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={(event) => setEditValue(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleSaveRename}
          onClick={(event) => event.stopPropagation()}
          className="bg-surface-base border-accent-primary text-primary h-8 min-w-0 flex-1 rounded border px-2 py-1 text-sm outline-none"
          aria-label="Edit chat title"
        />
      ) : (
        <>
          {session.hasActiveDeepResearch && (
            <LoadingSpinner
              className="text-accent-primary shrink-0"
              aria-label="Deep research in progress"
            />
          )}

          <Text kind="body/regular/sm" className="text-primary min-w-0 flex-1 truncate">
            {session.title}
          </Text>

          {isHovered && (
            <Flex align="center" gap="1" className="shrink-0">
              <Button
                kind="tertiary"
                size="tiny"
                onClick={(event) => {
                  event.stopPropagation()
                  setEditValue(session.title)
                  setIsEditing(true)
                }}
                disabled={isBusy || isSessionActive}
                aria-label={isBusy || isSessionActive ? 'Rename chat (disabled)' : 'Rename chat'}
                title={
                  isBusy || isSessionActive
                    ? 'Cannot rename while operations are in progress'
                    : 'Rename chat'
                }
              >
                <Edit height={16} width={16} />
              </Button>
              <Button
                kind="tertiary"
                size="tiny"
                color="danger"
                onClick={(event) => {
                  event.stopPropagation()
                  onDelete?.(session.id)
                }}
                disabled={isBusy || isSessionActive}
                aria-label={isBusy || isSessionActive ? 'Delete chat (disabled)' : 'Delete chat'}
                title={
                  isBusy || isSessionActive
                    ? 'Cannot delete while operations are in progress'
                    : 'Delete chat'
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

const filterSessions = (sessions: Session[], searchQuery: string): Session[] => {
  if (!searchQuery.trim()) {
    return sessions
  }

  const query = searchQuery.toLowerCase()
  return sessions.filter((session) => session.title.toLowerCase().includes(query))
}

const isSameDay = (left: Date, right: Date): boolean =>
  left.getFullYear() === right.getFullYear() &&
  left.getMonth() === right.getMonth() &&
  left.getDate() === right.getDate()
