// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * SettingsPanel Component
 *
 * Right-side panel for application preferences.
 * Keeps runtime provider health out of settings so this panel can focus on
 * appearance and configuration selection.
 */

'use client'

import { type FC, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Banner, Button, Flex, SegmentedControl, SidePanel, Switch, Text, TextInput } from '@/adapters/ui'
import { Settings } from '@/adapters/ui/icons'
import {
  checkBackendHealth,
  createProviderStatusClient,
  type LocalResearchOptionsFromAPI,
  type LocalTavilyApiKeyStatusFromAPI,
} from '@/adapters/api'
import { useAuth } from '@/adapters/auth'
import { useLayoutStore } from '../store'
import {
  CodeDetailBlock,
  formatConfigPathLabel,
  getConfigDisplayMeta,
  getConfigKindLabel,
  getDisplayConfigName,
  getStatusLabel,
  looksLikeGeneratedRuntimeConfig,
  StatusPill,
  toneForProviderStatus,
  type PillTone,
  useProviderDashboardData,
} from '../provider-dashboard'

const MIN_PANEL_WIDTH = 340
const MAX_PANEL_WIDTH = 720
const DEFAULT_PANEL_WIDTH = 430

const useResizableWidth = (defaultWidth: number) => {
  const [width, setWidth] = useState(defaultWidth)
  const dragging = useRef(false)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    const startX = e.clientX
    const startWidth = width

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!dragging.current) return
      const delta = startX - moveEvent.clientX
      setWidth(Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, startWidth + delta)))
    }

    const onMouseUp = () => {
      dragging.current = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [width])

  return { width, onMouseDown }
}

interface ConfigDetailModel {
  name: string
  role: string
  reasoning_effort?: string
}

const CONFIG_DETAIL_MAP: Record<string, { models: ConfigDetailModel[] }> = {
  'configs/config_preset_frontier_gpt54_xhigh.yml': {
    models: [
      { name: 'gpt-5.4', role: 'Planner / Orchestrator', reasoning_effort: 'xhigh' },
      { name: 'nvidia/nemotron-3-nano-30b-a3b', role: 'Research Worker' },
      { name: 'nvidia/nemotron-mini-4b-instruct', role: 'Summary' },
    ],
  },
  'configs/config_preset_frontier_gpt54_xhigh_super.yml': {
    models: [
      { name: 'gpt-5.4', role: 'Planner / Orchestrator', reasoning_effort: 'xhigh' },
      { name: 'nvidia/llama-3.3-nemotron-super-49b-v1.5', role: 'Research Worker' },
      { name: 'nvidia/nemotron-3-nano-30b-a3b', role: 'Intent / Clarifier' },
      { name: 'nvidia/nemotron-mini-4b-instruct', role: 'Summary' },
    ],
  },
  'configs/config_preset_max_quality.yml': {
    models: [
      { name: 'gpt-5.4', role: 'Planner / Orchestrator', reasoning_effort: 'xhigh' },
      { name: 'nvidia/llama-3.1-nemotron-ultra-253b-v1', role: 'Research Worker' },
      { name: 'nvidia/nemotron-3-nano-30b-a3b', role: 'Intent / Clarifier' },
      { name: 'nvidia/nemotron-mini-4b-instruct', role: 'Summary' },
    ],
  },
  'configs/config_preset_nvidia_super_only.yml': {
    models: [
      { name: 'nvidia/llama-3.3-nemotron-super-49b-v1.5', role: 'Planner / Research Worker' },
      { name: 'nvidia/nemotron-3-nano-30b-a3b', role: 'Intent / Clarifier' },
      { name: 'nvidia/nemotron-mini-4b-instruct', role: 'Summary' },
    ],
  },
  'configs/config_preset_current_setup.yml': {
    models: [
      { name: 'openai/gpt-oss-120b', role: 'Planner / Orchestrator' },
      { name: 'nvidia/nemotron-3-nano-30b-a3b', role: 'Research Worker' },
      { name: 'nvidia/nemotron-mini-4b-instruct', role: 'Summary' },
    ],
  },
  'configs/config_web_default_llamaindex.yml': {
    models: [
      { name: 'openai/gpt-oss-120b', role: 'Planner / Orchestrator' },
      { name: 'nvidia/nemotron-3-nano-30b-a3b', role: 'Research Worker' },
      { name: 'nvidia/nemotron-mini-4b-instruct', role: 'Summary' },
    ],
  },
  'configs/config_frontier_models.yml': {
    models: [
      { name: 'gpt-5.2', role: 'Planner / Orchestrator' },
      { name: 'nvidia/nemotron-3-nano-30b-a3b', role: 'Research Worker' },
      { name: 'nvidia/nemotron-mini-4b-instruct', role: 'Summary' },
    ],
  },
  'configs/config_web_frag.yml': {
    models: [
      { name: 'openai/gpt-oss-120b', role: 'Planner / Orchestrator' },
      { name: 'nvidia/nemotron-3-nano-30b-a3b', role: 'Research Worker' },
    ],
  },
}

const getConfigTone = ({
  kind,
  recommended,
  active,
}: {
  kind?: string | null
  recommended?: boolean
  active?: boolean
}): PillTone => {
  if (active) {
    return 'success'
  }
  if (recommended) {
    return 'accent'
  }
  if (kind === 'repo_config') {
    return 'neutral'
  }
  return 'warning'
}

const CurrentConfigCard = ({
  title,
  models,
  statusLabel,
  tone,
  pathLabel,
  pathValue,
}: {
  title: string
  models: string[]
  statusLabel: string
  tone: PillTone
  pathLabel?: string | null
  pathValue?: string | null
}) => (
  <div className="py-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <Text kind="label/semibold/xs" className="block text-subtle uppercase tracking-[0.08em]">
          Current Research Setup
        </Text>
        <Text kind="label/semibold/sm" className="mt-2 block text-primary leading-6">
          {title}
        </Text>
      </div>
      <StatusPill tone={tone}>{statusLabel}</StatusPill>
    </div>

    {models.length > 0 && (
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
        {models.map((model) => (
          <code key={model} className="text-[11px] leading-5 text-subtle">{model}</code>
        ))}
      </div>
    )}

    {pathValue && pathLabel && (
      <div className="mt-3">
        <CodeDetailBlock label={pathLabel} value={pathValue} />
      </div>
    )}
  </div>
)

const ConfigOptionCard = ({
  title,
  kindLabel,
  configPath,
  description,
  recommended,
  active,
  selected,
  expanded,
  onSelect,
}: {
  title: string
  kindLabel: string
  configPath: string
  description: string
  recommended: boolean
  active: boolean
  selected: boolean
  expanded: boolean
  onSelect: () => void
}) => {
  const detail = CONFIG_DETAIL_MAP[configPath]

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`border-base w-full border-b py-3 text-left transition first:border-t ${
        selected
          ? 'bg-surface-raised/40'
          : 'hover:bg-surface-raised/50'
      }`}
      aria-pressed={selected}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Text kind="label/semibold/sm" className="block text-primary leading-6">
            {title}
          </Text>
          {active && (
            <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-emerald-600 dark:text-emerald-400">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Live
            </span>
          )}
          {recommended && !active && (
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-primary/50">
              Rec
            </span>
          )}
          {selected && !active && (
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#76b900]">
              Sel
            </span>
          )}
        </div>
        <StatusPill tone={getConfigTone({ kind: kindLabel === 'Workflow Config' ? 'repo_config' : 'preset', recommended, active })}>
          {kindLabel}
        </StatusPill>
      </div>

      {expanded && (
        <div className="mt-2.5 space-y-2">
          <Text kind="body/regular/xs" className="block text-subtle leading-5">
            {description}
          </Text>

          {detail && (
            <div className="space-y-1">
              {detail.models.map((model) => (
                <div key={`${model.name}-${model.role}`} className="flex items-baseline justify-between gap-2">
                  <code className="text-[11px] leading-5 text-primary">{model.name}</code>
                  <div className="flex items-center gap-2">
                    {model.reasoning_effort && (
                      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-amber-600 dark:text-amber-400">
                        {model.reasoning_effort}
                      </span>
                    )}
                    <span className="shrink-0 text-[10px] text-subtle">{model.role}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </button>
  )
}

type ConfigPanelTab = 'model' | 'options'

interface DraftResearchOptions {
  knowledgeLayerEnabled: boolean
  generateSummary: boolean
  topK: string
  minTotalSourcesRetrieved: string
  minTotalCitedSources: string
}

const ConfigOptionRow = ({
  title,
  description,
  control,
}: {
  title: string
  description: string
  control: ReactNode
}) => (
  <div className="border-base rounded-xl border px-4 py-3">
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <Text kind="label/semibold/sm" className="block text-primary">
          {title}
        </Text>
        <Text kind="body/regular/xs" className="mt-1 block text-subtle leading-5">
          {description}
        </Text>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  </div>
)

const toDraftResearchOptions = (
  options: Pick<
    LocalResearchOptionsFromAPI,
    | 'knowledge_layer_enabled'
    | 'generate_summary'
    | 'top_k'
    | 'min_total_sources_retrieved'
    | 'min_total_cited_sources'
  >
): DraftResearchOptions => ({
  knowledgeLayerEnabled: options.knowledge_layer_enabled,
  generateSummary: options.generate_summary,
  topK: String(options.top_k),
  minTotalSourcesRetrieved: String(options.min_total_sources_retrieved),
  minTotalCitedSources: String(options.min_total_cited_sources),
})

export const SettingsPanel: FC = () => {
  const { idToken } = useAuth()
  const { rightPanel, closeRightPanel, openRightPanel } = useLayoutStore()
  const { providerStatus, loading, error, loadProviderStatus, presetOptions, sortedWorkers } = useProviderDashboardData({
    enabled: rightPanel === 'settings',
    autoRefreshMs: 0,
  })

  const [selectedPresetPath, setSelectedPresetPath] = useState('')
  const [configTab, setConfigTab] = useState<ConfigPanelTab>('model')
  const [applyMessage, setApplyMessage] = useState<string | null>(null)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [presetApplying, setPresetApplying] = useState(false)
  const [optionsLoading, setOptionsLoading] = useState(false)
  const [optionsApplying, setOptionsApplying] = useState(false)
  const [optionsError, setOptionsError] = useState<string | null>(null)
  const [researchOptions, setResearchOptions] = useState<LocalResearchOptionsFromAPI | null>(null)
  const [tavilyStatus, setTavilyStatus] = useState<LocalTavilyApiKeyStatusFromAPI | null>(null)
  const [tavilyLoading, setTavilyLoading] = useState(false)
  const [tavilyApplying, setTavilyApplying] = useState(false)
  const [tavilyError, setTavilyError] = useState<string | null>(null)
  const [draftTavilyApiKey, setDraftTavilyApiKey] = useState('')
  const [draftOptions, setDraftOptions] = useState<DraftResearchOptions>({
    knowledgeLayerEnabled: false,
    generateSummary: false,
    topK: '5',
    minTotalSourcesRetrieved: '0',
    minTotalCitedSources: '0',
  })
  const [reloadPending, setReloadPending] = useState(false)
  const [reloadOperationId, setReloadOperationId] = useState<string | null>(null)
  const { width: panelWidth, onMouseDown: onResizeMouseDown } = useResizableWidth(DEFAULT_PANEL_WIDTH)

  const isOpen = rightPanel === 'settings'
  const currentPresetPath = providerStatus?.config_runtime?.current_config_path ?? ''
  const canApplyPresets = providerStatus?.config_runtime?.can_apply_presets ?? false
  const tavilyProvider = providerStatus?.providers.find((provider) => provider.id === 'tavily') ?? null

  const currentPreset = useMemo(() => {
    const configRuntime = providerStatus?.config_runtime
    if (!configRuntime) {
      return null
    }

    return (
      presetOptions.find((preset) => preset.id === configRuntime.current_preset_id) ??
      presetOptions.find((preset) => preset.config_path === configRuntime.current_config_path) ??
      presetOptions.find((preset) => preset.current) ??
      null
    )
  }, [presetOptions, providerStatus])

  const activePresetPath = currentPreset?.config_path ?? currentPresetPath

  const liveModels = useMemo(() => {
    const modelSet = new Set<string>()
    for (const worker of sortedWorkers) {
      for (const llm of worker.llms) {
        if (llm.model_name) modelSet.add(llm.model_name)
      }
      for (const call of worker.runtime_calls) {
        if (call.model_name) modelSet.add(call.model_name)
      }
    }
    for (const provider of providerStatus?.providers ?? []) {
      for (const model of provider.models) {
        modelSet.add(model)
      }
    }
    return Array.from(modelSet)
  }, [sortedWorkers, providerStatus])

  useEffect(() => {
    if (presetOptions.length === 0) {
      return
    }

    setSelectedPresetPath((current) => {
      if (current && presetOptions.some((preset) => preset.config_path === current)) {
        return current
      }

      const currentOption = presetOptions.find((preset) => preset.current)
      return currentOption?.config_path ?? presetOptions[0]?.config_path ?? current
    })
  }, [presetOptions])

  const loadResearchOptions = useCallback(
    async (signal?: AbortSignal, options?: { silent?: boolean }) => {
      if (!options?.silent) {
        setOptionsLoading(true)
      }
      setOptionsError(null)

      try {
        const client = createProviderStatusClient({ authToken: idToken || undefined })
        const response = await client.getLocalResearchOptions(signal)
        setResearchOptions(response)
        setDraftOptions(toDraftResearchOptions(response))
      } catch (loadError) {
        if (signal?.aborted) {
          return
        }
        setOptionsError(
          loadError instanceof Error ? loadError.message : 'Failed to load local research options'
        )
      } finally {
        if (!options?.silent) {
          setOptionsLoading(false)
        }
      }
    },
    [idToken]
  )

  const loadTavilyStatus = useCallback(
    async (signal?: AbortSignal, options?: { silent?: boolean }) => {
      if (!options?.silent) {
        setTavilyLoading(true)
      }
      setTavilyError(null)

      try {
        const client = createProviderStatusClient({ authToken: idToken || undefined })
        const response = await client.getLocalTavilyApiKeyStatus(signal)
        setTavilyStatus(response)
      } catch (loadError) {
        if (signal?.aborted) {
          return
        }
        setTavilyError(
          loadError instanceof Error ? loadError.message : 'Failed to load the local Tavily API key status'
        )
      } finally {
        if (!options?.silent) {
          setTavilyLoading(false)
        }
      }
    },
    [idToken]
  )

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const controller = new AbortController()
    void loadResearchOptions(controller.signal)
    void loadTavilyStatus(controller.signal)

    return () => {
      controller.abort()
    }
  }, [isOpen, loadResearchOptions, loadTavilyStatus])

  useEffect(() => {
    if (!reloadPending) {
      return
    }

    let cancelled = false
    let timeoutId: number | null = null

    const pollReloadStatus = async () => {
      if (cancelled) {
        return
      }

      try {
        const client = createProviderStatusClient({ authToken: idToken || undefined })
        const status = await client.getLocalConfigReloadStatus()
        const isCurrentOperation =
          !reloadOperationId || !status.operation_id || status.operation_id === reloadOperationId

        if (isCurrentOperation && status.message) {
          setApplyMessage(status.message)
        }

        if (!isCurrentOperation) {
          timeoutId = window.setTimeout(() => {
            void pollReloadStatus()
          }, 1500)
          return
        }

        if (status.state === 'ready') {
          const healthy = await checkBackendHealth()
          if (healthy) {
            window.location.reload()
            return
          }
        }

        if (status.state === 'rolled_back' || status.state === 'failed') {
          setReloadPending(false)
          setReloadOperationId(null)
          setApplyError(status.error ? `${status.message} ${status.error}` : status.message)
          setSelectedPresetPath(status.previous_config_path ?? activePresetPath)
          void loadProviderStatus(undefined, { silent: true })
          void loadResearchOptions(undefined, { silent: true })
          void loadTavilyStatus(undefined, { silent: true })
          return
        }
      } catch (statusError) {
        setReloadPending(false)
        setReloadOperationId(null)
        setApplyError(
          statusError instanceof Error
            ? statusError.message
            : 'The backend reload status could not be read from the local frontend.'
        )
        return
      }

      timeoutId = window.setTimeout(() => {
        void pollReloadStatus()
      }, 1500)
    }

    timeoutId = window.setTimeout(() => {
      void pollReloadStatus()
    }, 800)

    return () => {
      cancelled = true
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [activePresetPath, idToken, loadProviderStatus, loadResearchOptions, loadTavilyStatus, reloadOperationId, reloadPending])

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        openRightPanel('settings')
      } else {
        closeRightPanel()
      }
    },
    [closeRightPanel, openRightPanel]
  )

  const handleConfigTabChange = useCallback((value: string) => {
    setConfigTab(value as ConfigPanelTab)
  }, [])

  const handlePresetApply = useCallback(async () => {
    if (!selectedPresetPath) {
      return
    }

    setPresetApplying(true)
    setApplyError(null)
    setApplyMessage(null)
    setReloadPending(false)
    setReloadOperationId(null)

    try {
      const client = createProviderStatusClient({ authToken: idToken || undefined })
      const response = await client.applyConfigPreset(selectedPresetPath)
      setApplyMessage(response.message)
      setReloadOperationId(response.operation_id ?? null)
      setReloadPending(Boolean(response.operation_id))

      if (!response.operation_id) {
        void loadProviderStatus(undefined, { silent: true })
        void loadResearchOptions(undefined, { silent: true })
      }
    } catch (applyError) {
      setApplyError(applyError instanceof Error ? applyError.message : 'Failed to apply config preset')
    } finally {
      setPresetApplying(false)
    }
  }, [idToken, loadProviderStatus, loadResearchOptions, selectedPresetPath])

  const handleOptionsApply = useCallback(async () => {
    const parsedTopK = Number(draftOptions.topK)
    const parsedMinTotalSourcesRetrieved = Number(draftOptions.minTotalSourcesRetrieved)
    const parsedMinTotalCitedSources = Number(draftOptions.minTotalCitedSources)
    const invalidTopK = !Number.isInteger(parsedTopK) || parsedTopK < 1 || parsedTopK > 50
    const invalidRetrievedFloor =
      !Number.isInteger(parsedMinTotalSourcesRetrieved) ||
      parsedMinTotalSourcesRetrieved < 0 ||
      parsedMinTotalSourcesRetrieved > 5000
    const invalidCitedFloor =
      !Number.isInteger(parsedMinTotalCitedSources) ||
      parsedMinTotalCitedSources < 0 ||
      parsedMinTotalCitedSources > 5000
    const invalidFloorRelationship =
      parsedMinTotalSourcesRetrieved > 0 && parsedMinTotalCitedSources > parsedMinTotalSourcesRetrieved

    if (
      !researchOptions ||
      invalidTopK ||
      invalidRetrievedFloor ||
      invalidCitedFloor ||
      invalidFloorRelationship
    ) {
      return
    }

    setOptionsApplying(true)
    setOptionsError(null)
    setApplyError(null)
    setApplyMessage(null)
    setReloadPending(false)
    setReloadOperationId(null)

    try {
      const client = createProviderStatusClient({ authToken: idToken || undefined })
      const response = await client.applyLocalResearchOptions({
        knowledge_layer_enabled: draftOptions.knowledgeLayerEnabled,
        generate_summary: draftOptions.generateSummary,
        top_k: parsedTopK,
        min_total_sources_retrieved: parsedMinTotalSourcesRetrieved,
        min_total_cited_sources: parsedMinTotalCitedSources,
      })

      setApplyMessage(response.message)
      if (response.options) {
        setResearchOptions(response.options)
        setDraftOptions(toDraftResearchOptions(response.options))
      }
      setReloadOperationId(response.operation_id ?? null)
      setReloadPending(Boolean(response.operation_id))

      if (!response.operation_id) {
        void loadProviderStatus(undefined, { silent: true })
        void loadResearchOptions(undefined, { silent: true })
      }
    } catch (nextError) {
      setApplyError(
        nextError instanceof Error ? nextError.message : 'Failed to apply local research options'
      )
    } finally {
      setOptionsApplying(false)
    }
  }, [draftOptions, idToken, loadProviderStatus, loadResearchOptions, researchOptions])

  const handleTavilyApply = useCallback(async () => {
    const nextApiKey = draftTavilyApiKey.trim()
    if (!nextApiKey) {
      return
    }

    setTavilyApplying(true)
    setApplyError(null)
    setApplyMessage(null)
    setReloadPending(false)
    setReloadOperationId(null)

    try {
      const client = createProviderStatusClient({ authToken: idToken || undefined })
      const response = await client.updateLocalTavilyApiKey({ api_key: nextApiKey })

      setApplyMessage(response.message)
      if (response.status) {
        setTavilyStatus(response.status)
      }
      setDraftTavilyApiKey('')
      setReloadOperationId(response.operation_id ?? null)
      setReloadPending(Boolean(response.operation_id))

      if (!response.operation_id) {
        void loadProviderStatus(undefined, { silent: true })
        void loadResearchOptions(undefined, { silent: true })
        void loadTavilyStatus(undefined, { silent: true })
      }
    } catch (nextError) {
      setApplyError(
        nextError instanceof Error ? nextError.message : 'Failed to update the local Tavily API key'
      )
    } finally {
      setTavilyApplying(false)
    }
  }, [draftTavilyApiKey, idToken, loadProviderStatus, loadResearchOptions, loadTavilyStatus])

  const currentConfigCard = useMemo(() => {
    const configRuntime = providerStatus?.config_runtime
    if (!configRuntime) {
      return null
    }

    const generated =
      looksLikeGeneratedRuntimeConfig(configRuntime.current_config_name) ||
      looksLikeGeneratedRuntimeConfig(configRuntime.current_config_path)

    return {
      title: getDisplayConfigName({ configRuntime, currentPreset }),
      statusLabel: currentPreset ? getConfigKindLabel(currentPreset) : generated ? 'Generated Runtime' : 'Workflow Config',
      tone: (currentPreset
        ? getConfigTone({
            kind: currentPreset.kind,
            recommended: currentPreset.recommended,
            active: true,
          })
        : generated
          ? 'warning'
          : 'neutral') as PillTone,
      pathLabel: formatConfigPathLabel(configRuntime.current_config_path),
      pathValue: configRuntime.current_config_path ?? null,
    }
  }, [currentPreset, providerStatus])

  const parsedTopK = Number(draftOptions.topK)
  const parsedMinTotalSourcesRetrieved = Number(draftOptions.minTotalSourcesRetrieved)
  const parsedMinTotalCitedSources = Number(draftOptions.minTotalCitedSources)
  const topKIsValid = Number.isInteger(parsedTopK) && parsedTopK >= 1 && parsedTopK <= 50
  const minTotalSourcesRetrievedIsValid =
    Number.isInteger(parsedMinTotalSourcesRetrieved) &&
    parsedMinTotalSourcesRetrieved >= 0 &&
    parsedMinTotalSourcesRetrieved <= 5000
  const minTotalCitedSourcesIsValid =
    Number.isInteger(parsedMinTotalCitedSources) &&
    parsedMinTotalCitedSources >= 0 &&
    parsedMinTotalCitedSources <= 5000
  const sourceFloorRelationshipIsValid =
    parsedMinTotalSourcesRetrieved === 0 || parsedMinTotalCitedSources <= parsedMinTotalSourcesRetrieved
  const tavilyKeyDirty = draftTavilyApiKey.trim().length > 0
  const optionsDirty =
    !!researchOptions &&
    (
      draftOptions.knowledgeLayerEnabled !== researchOptions.knowledge_layer_enabled ||
      draftOptions.generateSummary !== researchOptions.generate_summary ||
      parsedTopK !== researchOptions.top_k ||
      parsedMinTotalSourcesRetrieved !== researchOptions.min_total_sources_retrieved ||
      parsedMinTotalCitedSources !== researchOptions.min_total_cited_sources
    )
  const tavilyStatusPill = tavilyProvider
    ? {
        label: getStatusLabel(tavilyProvider),
        tone: toneForProviderStatus(tavilyProvider),
      }
    : tavilyStatus?.configured
      ? {
          label: 'Saved',
          tone: 'warning' as PillTone,
        }
      : {
          label: 'Not Set',
          tone: 'neutral' as PillTone,
        }

  return (
    <SidePanel
      className="bg-surface-base top-[var(--header-height)] h-[calc(100vh-var(--header-height))] rounded-l-2xl"
      style={{ width: panelWidth }}
      open={isOpen}
      onOpenChange={handleOpenChange}
      side="right"
      bordered
      closeOnClickOutside={false}
      slotHeading={
        <Flex align="center" gap="2">
          <Settings className="h-5 w-5" />
          Config
        </Flex>
      }
      slotFooter={
        <Text kind="body/regular/xs" className="text-subtle">
          Model, Tavily key, and runtime option changes reload the local backend workflow.
        </Text>
      }
    >
      {/* Resize handle */}
      <div
        onMouseDown={onResizeMouseDown}
        className="absolute left-0 top-0 z-10 h-full w-1 cursor-col-resize hover:bg-primary/10 active:bg-primary/20"
      />

      <Flex direction="col" gap="6">
        <SegmentedControl
          value={configTab}
          onValueChange={handleConfigTabChange}
          size="small"
          className="w-full"
          items={[
            { value: 'model', children: 'Model' },
            { value: 'options', children: 'Options' },
          ]}
        />

        {applyMessage && (
          <Banner kind="inline" status="info" className="px-3 py-2">
            {applyMessage}
          </Banner>
        )}

        {applyError && (
          <Banner kind="inline" status="warning" className="px-3 py-2">
            {applyError}
          </Banner>
        )}

        {configTab === 'model' ? (
          loading ? (
            <Text kind="body/regular/xs" className="text-subtle">
              Loading configuration details...
            </Text>
          ) : error ? (
            <Flex direction="col" gap="2">
              <Text kind="body/regular/xs" className="text-error">
                {error}
              </Text>
              <Text kind="body/regular/xs" className="text-subtle">
                Provider health and worker activity are available from the Providers panel in the header once the backend reconnects.
              </Text>
            </Flex>
          ) : (
            <>
              {currentConfigCard && (
                <CurrentConfigCard
                  title={currentConfigCard.title}
                  models={liveModels}
                  statusLabel={currentConfigCard.statusLabel}
                  tone={currentConfigCard.tone}
                  pathLabel={currentConfigCard.pathLabel}
                  pathValue={currentConfigCard.pathValue}
                />
              )}

              <div className="border-base border-t" />

              <Flex direction="col" gap="3">
                <Text kind="label/semibold/xs" className="text-subtle uppercase tracking-[0.08em]">
                  Choose Research Configuration
                </Text>

                {presetOptions.length > 0 ? (
                  <div>
                    {presetOptions.map((preset) => {
                      const meta = getConfigDisplayMeta({
                        configPath: preset.config_path,
                        name: preset.name,
                        description: preset.description,
                      })
                      const isActive = preset.config_path === activePresetPath
                      const isSelected = preset.config_path === selectedPresetPath

                      return (
                        <ConfigOptionCard
                          key={preset.config_path}
                          title={meta.title}
                          description={meta.summary}
                          kindLabel={getConfigKindLabel(preset)}
                          configPath={preset.config_path}
                          recommended={preset.recommended}
                          active={isActive}
                          selected={isSelected}
                          expanded={isSelected}
                          onSelect={() => setSelectedPresetPath(preset.config_path)}
                        />
                      )
                    })}
                  </div>
                ) : (
                  <Text kind="body/regular/xs" className="text-subtle">
                    No web-enabled configurations were detected for this backend.
                  </Text>
                )}

                {canApplyPresets ? (
                  <Button
                    kind="secondary"
                    size="small"
                    onClick={() => void handlePresetApply()}
                    disabled={
                      presetApplying ||
                      !selectedPresetPath ||
                      reloadPending ||
                      selectedPresetPath === activePresetPath
                    }
                    aria-label="Apply selected configuration"
                  >
                    {reloadPending
                      ? 'Reloading Backend...'
                      : selectedPresetPath === activePresetPath
                        ? 'Already Running'
                        : 'Apply & Reload Backend'}
                  </Button>
                ) : (
                  <Text kind="body/regular/xs" className="text-subtle leading-5">
                    In-UI switching is available only when AI-Q is running via `./scripts/start_local_stack.sh`. For an arbitrary file path outside `/configs`, start the stack with `--config_file`.
                  </Text>
                )}
              </Flex>
            </>
          )
        ) : optionsLoading ? (
          <Text kind="body/regular/xs" className="text-subtle">
            Loading runtime knowledge options...
          </Text>
        ) : optionsError ? (
          <Text kind="body/regular/xs" className="text-error">
            {optionsError}
          </Text>
        ) : !researchOptions ? (
          <Text kind="body/regular/xs" className="text-subtle">
            Local research options are unavailable for the current runtime.
          </Text>
        ) : (
          <Flex direction="col" gap="4">
            <div>
              <Text kind="label/semibold/xs" className="text-subtle uppercase tracking-[0.08em]">
                Research Runtime Options
              </Text>
              <Text kind="body/regular/xs" className="mt-1 block text-subtle leading-5">
                These settings write a generated runtime config and reload the local backend so new research runs pick them up.
              </Text>
            </div>

            {researchOptions.config_path && (
              <CodeDetailBlock
                label={formatConfigPathLabel(researchOptions.config_path) ?? 'Config Source'}
                value={researchOptions.config_path}
              />
            )}

            {!researchOptions.supported ? (
              <Flex direction="col" gap="2">
                {researchOptions.notes.map((note) => (
                  <Text key={note} kind="body/regular/xs" className="text-subtle leading-5">
                    {note}
                  </Text>
                ))}
              </Flex>
            ) : (
              <>
                <ConfigOptionRow
                  title="Knowledge Layer"
                  description="Enable or disable uploaded-document retrieval as a research tool."
                  control={
                    <Switch
                      size="small"
                      checked={draftOptions.knowledgeLayerEnabled}
                      disabled={!researchOptions.can_edit || optionsApplying || reloadPending}
                      onCheckedChange={(checked) =>
                        setDraftOptions((current) => ({
                          ...current,
                          knowledgeLayerEnabled: checked,
                        }))
                      }
                      attributes={{
                        SwitchTrack: {
                          'aria-label': 'Toggle knowledge layer',
                          'aria-labelledby': undefined,
                        },
                      }}
                    />
                  }
                />

                <ConfigOptionRow
                  title="Generate Summary"
                  description="Store file-level summaries so the planner sees uploaded documents before retrieval starts."
                  control={
                    <Switch
                      size="small"
                      checked={draftOptions.generateSummary}
                      disabled={!researchOptions.can_edit || optionsApplying || reloadPending}
                      onCheckedChange={(checked) =>
                        setDraftOptions((current) => ({
                          ...current,
                          generateSummary: checked,
                        }))
                      }
                      attributes={{
                        SwitchTrack: {
                          'aria-label': 'Toggle generate summary',
                          'aria-labelledby': undefined,
                        },
                      }}
                    />
                  }
                />

                <ConfigOptionRow
                  title="Top K"
                  description="Control how many retrieved chunks are returned to the agent for each knowledge search."
                  control={
                    <TextInput
                      value={draftOptions.topK}
                      onValueChange={(value) =>
                        setDraftOptions((current) => ({
                          ...current,
                          topK: value,
                        }))
                      }
                      type="number"
                      size="small"
                      className="w-24"
                      placeholder="5"
                      disabled={!researchOptions.can_edit || optionsApplying || reloadPending}
                      attributes={{
                        TextInputValue: {
                          min: 1,
                          max: 50,
                          step: 1,
                          inputMode: 'numeric',
                          'aria-label': 'Top K retrieval count',
                        },
                      }}
                    />
                  }
                />

                {!topKIsValid && (
                  <Text kind="body/regular/xs" className="text-error">
                    Top K must be a whole number between 1 and 50.
                  </Text>
                )}

                <div className="pt-2">
                  <Text kind="label/semibold/xs" className="text-subtle uppercase tracking-[0.08em]">
                    Research Source Floors
                  </Text>
                  <Text kind="body/regular/xs" className="mt-1 block text-subtle leading-5">
                    These are hard per-run minimums. They count distinct verified sources captured or retained after citation verification. Use 0 to disable either floor.
                  </Text>
                </div>

                <ConfigOptionRow
                  title="Minimum Total Sources Retrieved"
                  description="Require each deep research run to capture at least this many distinct verified sources before it can finish."
                  control={
                    <TextInput
                      value={draftOptions.minTotalSourcesRetrieved}
                      onValueChange={(value) =>
                        setDraftOptions((current) => ({
                          ...current,
                          minTotalSourcesRetrieved: value,
                        }))
                      }
                      type="number"
                      size="small"
                      className="w-28"
                      placeholder="0"
                      disabled={!researchOptions.can_edit || optionsApplying || reloadPending}
                      attributes={{
                        TextInputValue: {
                          min: 0,
                          max: 5000,
                          step: 1,
                          inputMode: 'numeric',
                          'aria-label': 'Minimum total sources retrieved',
                        },
                      }}
                    />
                  }
                />

                <ConfigOptionRow
                  title="Minimum Total Cited Sources"
                  description="Require the final report to retain at least this many distinct verified sources after citation verification."
                  control={
                    <TextInput
                      value={draftOptions.minTotalCitedSources}
                      onValueChange={(value) =>
                        setDraftOptions((current) => ({
                          ...current,
                          minTotalCitedSources: value,
                        }))
                      }
                      type="number"
                      size="small"
                      className="w-28"
                      placeholder="0"
                      disabled={!researchOptions.can_edit || optionsApplying || reloadPending}
                      attributes={{
                        TextInputValue: {
                          min: 0,
                          max: 5000,
                          step: 1,
                          inputMode: 'numeric',
                          'aria-label': 'Minimum total cited sources',
                        },
                      }}
                    />
                  }
                />

                {!minTotalSourcesRetrievedIsValid && (
                  <Text kind="body/regular/xs" className="text-error">
                    Minimum Total Sources Retrieved must be a whole number between 0 and 5000.
                  </Text>
                )}

                {!minTotalCitedSourcesIsValid && (
                  <Text kind="body/regular/xs" className="text-error">
                    Minimum Total Cited Sources must be a whole number between 0 and 5000.
                  </Text>
                )}

                {minTotalSourcesRetrievedIsValid &&
                  minTotalCitedSourcesIsValid &&
                  !sourceFloorRelationshipIsValid && (
                    <Text kind="body/regular/xs" className="text-error">
                      Minimum Total Cited Sources cannot exceed Minimum Total Sources Retrieved.
                    </Text>
                  )}

                <Banner kind="inline" status="info" className="px-3 py-2">
                  {researchOptions.notes.join(' ')}
                </Banner>

                {researchOptions.can_edit ? (
                  <Button
                    kind="secondary"
                    size="small"
                    onClick={() => void handleOptionsApply()}
                    disabled={
                      optionsApplying ||
                      reloadPending ||
                      !topKIsValid ||
                      !minTotalSourcesRetrievedIsValid ||
                      !minTotalCitedSourcesIsValid ||
                      !sourceFloorRelationshipIsValid ||
                      !optionsDirty
                    }
                    aria-label="Save research options"
                  >
                    {reloadPending ? 'Reloading Backend...' : 'Save Options & Reload Backend'}
                  </Button>
                ) : (
                  <Text kind="body/regular/xs" className="text-subtle leading-5">
                    In-UI option editing is available only when AI-Q is running via `./scripts/start_local_stack.sh`.
                  </Text>
                )}
              </>
            )}

            <div className="border-base border-t" />

            <Flex direction="col" gap="4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <Text kind="label/semibold/xs" className="text-subtle uppercase tracking-[0.08em]">
                    Tavily Search Key
                  </Text>
                  <Text kind="body/regular/xs" className="mt-1 block text-subtle leading-5">
                    Update the Tavily API key stored in `deploy/.env`. Saving a new key reloads the local backend so the Tavily search tool picks up the new credential.
                  </Text>
                </div>
                <StatusPill tone={tavilyStatusPill.tone}>{tavilyStatusPill.label}</StatusPill>
              </div>

              {tavilyLoading ? (
                <Text kind="body/regular/xs" className="text-subtle">
                  Loading Tavily key status...
                </Text>
              ) : tavilyError ? (
                <Text kind="body/regular/xs" className="text-error">
                  {tavilyError}
                </Text>
              ) : !tavilyStatus ? (
                <Text kind="body/regular/xs" className="text-subtle">
                  Local Tavily key status is unavailable for the current runtime.
                </Text>
              ) : (
                <>
                  {tavilyStatus.env_path && (
                    <CodeDetailBlock label="Managed Env File" value={tavilyStatus.env_path} />
                  )}

                  <div className="border-base rounded-xl border px-4 py-4">
                    <Text kind="label/semibold/sm" className="block text-primary">
                      Tavily API Key
                    </Text>
                    <Text kind="body/regular/xs" className="mt-1 block text-subtle leading-5">
                      {tavilyStatus.configured
                        ? `Current saved value: ${tavilyStatus.key_hint ?? 'Configured'}. Enter a new key to replace it.`
                        : 'No Tavily key is saved yet. Enter one to enable Tavily-backed web search on the local stack.'}
                    </Text>

                    <TextInput
                      value={draftTavilyApiKey}
                      onValueChange={setDraftTavilyApiKey}
                      type="password"
                      size="small"
                      className="mt-3 w-full"
                      placeholder={tavilyStatus.configured ? 'Paste a replacement Tavily API key' : 'Paste your Tavily API key'}
                      disabled={!tavilyStatus.can_edit || tavilyApplying || reloadPending}
                      attributes={{
                        TextInputValue: {
                          'aria-label': 'Tavily API key',
                          autoComplete: 'off',
                          autoCapitalize: 'none',
                          autoCorrect: 'off',
                          spellCheck: false,
                        },
                      }}
                    />
                  </div>

                  <Banner kind="inline" status="info" className="px-3 py-2">
                    {tavilyStatus.notes.join(' ')}
                  </Banner>

                  {tavilyStatus.can_edit ? (
                    <Button
                      kind="secondary"
                      size="small"
                      onClick={() => void handleTavilyApply()}
                      disabled={tavilyApplying || reloadPending || !tavilyKeyDirty}
                      aria-label="Save Tavily API key"
                    >
                      {reloadPending ? 'Reloading Backend...' : 'Save Tavily Key & Reload Backend'}
                    </Button>
                  ) : (
                    <Text kind="body/regular/xs" className="text-subtle leading-5">
                      In-UI Tavily key editing is available only when AI-Q is running via `./scripts/start_local_stack.sh`.
                    </Text>
                  )}
                </>
              )}
            </Flex>
          </Flex>
        )}
      </Flex>
    </SidePanel>
  )
}
