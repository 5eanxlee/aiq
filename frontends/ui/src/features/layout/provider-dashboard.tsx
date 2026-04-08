'use client'

import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { type ConfigPresetFromAPI, type ConfigRuntimeFromAPI, createProviderStatusClient, type ProviderDashboardFromAPI, type ProviderStatusFromAPI } from '@/adapters/api'
import { useAuth } from '@/adapters/auth'

export type PillTone = 'neutral' | 'accent' | 'success' | 'warning' | 'error'

const PILL_TONE_CLASS_NAMES: Record<PillTone, string> = {
  neutral: 'border-black/10 dark:border-white/10 bg-transparent text-subtle',
  accent: 'border-black/10 dark:border-white/10 bg-transparent text-primary',
  success: 'border-emerald-600/30 dark:border-emerald-400/30 bg-transparent text-emerald-600 dark:text-emerald-400',
  warning: 'border-amber-600/30 dark:border-amber-400/30 bg-transparent text-amber-600 dark:text-amber-400',
  error: 'border-red-600/30 dark:border-red-400/30 bg-transparent text-red-600 dark:text-red-400',
}

const CONFIG_DISPLAY_OVERRIDES: Record<
  string,
  {
    title: string
    summary: string
  }
> = {
  'configs/config_web_default_llamaindex.yml': {
    title: 'Balanced Web Default',
    summary: 'NVIDIA-led web research with local LlamaIndex knowledge retrieval.',
  },
  'configs/config_web_frag.yml': {
    title: 'Foundational RAG',
    summary: 'Web research plus a remote FRAG retrieval backend for larger knowledge deployments.',
  },
  'configs/config_frontier_models.yml': {
    title: 'Frontier Hybrid',
    summary: 'OpenAI plans and orchestrates while NVIDIA handles most research execution.',
  },
  'configs/config_web_visibility_llamaindex.yml': {
    title: 'Balanced Web Default + Phoenix',
    summary: 'The balanced local stack with Phoenix visibility and tracing enabled.',
  },
  'configs/config_frontier_models_visibility.yml': {
    title: 'Frontier Hybrid + Phoenix',
    summary: 'The frontier hybrid stack with Phoenix visibility and tracing enabled.',
  },
  'configs/config_preset_current_setup.yml': {
    title: 'Current Setup Mirror',
    summary: 'Mirrors the default local AI-Q stack that ships on this branch.',
  },
  'configs/config_preset_frontier_gpt54_xhigh.yml': {
    title: 'GPT-5.4 X-High',
    summary: 'Frontier planning and orchestration with GPT-5.4 at x-high reasoning effort.',
  },
  'configs/config_preset_frontier_gpt54_xhigh_super.yml': {
    title: 'GPT-5.4 + Nemotron Super',
    summary: 'Frontier planning with stronger NVIDIA research workers for deeper investigations.',
  },
  'configs/config_preset_nvidia_super_only.yml': {
    title: 'NVIDIA Super Only',
    summary: 'An all-NVIDIA stack that favors stronger Nemotron workers over frontier APIs.',
  },
  'configs/config_preset_max_quality.yml': {
    title: 'Maximum Quality',
    summary: 'The highest-quality research preset, optimized for answer depth over cost or latency.',
  },
  'configs/config_preset_max_quality_gpt54_medium.yml': {
    title: 'Maximum Quality (GPT-5.4 Medium)',
    summary: 'The max-quality research stack with GPT-5.4 reduced to medium reasoning effort.',
  },
}

const FRIENDLY_WORD_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bopenai\b/gi, 'OpenAI'],
  [/\bnvidia\b/gi, 'NVIDIA'],
  [/\bgpt\b/gi, 'GPT'],
  [/\bapi\b/gi, 'API'],
  [/\brag\b/gi, 'RAG'],
  [/\bfrag\b/gi, 'FRAG'],
  [/\bllamaindex\b/gi, 'LlamaIndex'],
  [/\bxhigh\b/gi, 'X-High'],
]

const toTitleCase = (value: string): string =>
  value.replace(/\b([a-z])([a-z]*)/g, (_match, first: string, rest: string) => `${first.toUpperCase()}${rest}`)

const humanizeConfigLabel = (value: string): string => {
  let formatted = value.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  formatted = toTitleCase(formatted)

  for (const [pattern, replacement] of FRIENDLY_WORD_REPLACEMENTS) {
    formatted = formatted.replace(pattern, replacement)
  }

  return formatted
}

export const looksLikeGeneratedRuntimeConfig = (value?: string | null): boolean => {
  if (!value) {
    return false
  }

  const filename = value.split('/').pop() ?? value
  return /^nat_config.*\.ya?ml$/i.test(filename)
}

export const getConfigKindLabel = (config: ConfigPresetFromAPI): string =>
  config.kind === 'repo_config' ? 'Workflow Config' : 'Preset'

export const formatCapabilityLabel = (value: string): string =>
  value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())

export const getStatusLabel = (provider: ProviderStatusFromAPI): string => {
  switch (provider.status) {
    case 'ready':
      return provider.active ? 'Ready' : 'Connected'
    case 'limited':
      return 'Limited'
    case 'missing_config':
      return 'Missing Config'
    case 'error':
      return 'Issue'
    default:
      return provider.active ? 'Active' : 'Inactive'
  }
}

export const toneForProviderStatus = (provider: ProviderStatusFromAPI): PillTone => {
  switch (provider.status) {
    case 'ready':
      return 'success'
    case 'limited':
    case 'missing_config':
      return 'warning'
    case 'error':
      return 'error'
    default:
      return 'neutral'
  }
}

export const formatQuotaSummary = (provider: ProviderStatusFromAPI): string => {
  const quota = provider.quota

  if (!provider.configured) {
    return 'Configuration missing'
  }

  if (quota.supported) {
    if (typeof quota.remaining === 'number') {
      const unit = quota.unit ?? 'credits'
      const rateLimit =
        typeof quota.rate_limit === 'number' ? ` · ${quota.rate_limit}/s rate limit` : ''
      return `${quota.remaining.toLocaleString()} ${unit} remaining${rateLimit}`
    }
    if (typeof quota.limit === 'number' && typeof quota.used === 'number') {
      const unit = quota.unit ?? 'credits'
      return `${quota.used.toLocaleString()} / ${quota.limit.toLocaleString()} ${unit} used`
    }
  }

  if (quota.message) {
    return quota.message
  }

  if (provider.connected) {
    return 'Connected'
  }

  return 'Status unavailable'
}

export const getModelSettingParts = (config: {
  temperature?: number | null
  top_p?: number | null
  max_tokens?: number | null
}): string[] => {
  const parts: string[] = []

  if (typeof config.temperature === 'number') {
    parts.push(`Temp ${config.temperature}`)
  }
  if (typeof config.top_p === 'number') {
    parts.push(`Top P ${config.top_p}`)
  }
  if (typeof config.max_tokens === 'number') {
    parts.push(`Max ${config.max_tokens.toLocaleString()}`)
  }

  return parts
}

export const getObservedModelsSummary = (provider: ProviderStatusFromAPI): string | null => {
  const uniqueModels = Array.from(new Set(provider.runtime_calls.map((call) => call.model_name).filter(Boolean)))
  return uniqueModels.length > 0 ? uniqueModels.join(', ') : null
}

export const formatConfigPathLabel = (value?: string | null): string | null => {
  if (!value) {
    return null
  }

  const filename = value.split('/').pop() ?? value
  if (/^config_preset_/.test(filename)) {
    return 'Preset File'
  }
  if (/^config_/.test(filename)) {
    return 'Workflow File'
  }
  if (looksLikeGeneratedRuntimeConfig(value)) {
    return 'Runtime File'
  }
  return 'Config Source'
}

export const getConfigDisplayMeta = ({
  configPath,
  name,
  description,
}: {
  configPath?: string | null
  name?: string | null
  description?: string | null
}): { title: string; summary: string } => {
  const override = configPath ? CONFIG_DISPLAY_OVERRIDES[configPath] : undefined
  if (override) {
    return override
  }

  if (looksLikeGeneratedRuntimeConfig(name) || looksLikeGeneratedRuntimeConfig(configPath)) {
    return {
      title: 'Generated Runtime Config',
      summary:
        'The running backend was launched from a generated NAT config file, so the original preset name could not be recovered.',
    }
  }

  if (name?.trim()) {
    return {
      title: humanizeConfigLabel(name),
      summary:
        description?.trim() ||
        'Repo-managed research configuration available for the current local stack.',
    }
  }

  if (configPath) {
    const filename = configPath.split('/').pop()?.replace(/\.(ya?ml)$/i, '') ?? configPath
    return {
      title: humanizeConfigLabel(filename.replace(/^config_/, '')),
      summary:
        description?.trim() ||
        'Repo-managed research configuration available for the current local stack.',
    }
  }

  return {
    title: 'Unknown Configuration',
    summary: 'The current backend configuration could not be identified from the running process.',
  }
}

export const getDisplayConfigName = ({
  configRuntime,
  currentPreset,
}: {
  configRuntime?: ConfigRuntimeFromAPI | null
  currentPreset?: ConfigPresetFromAPI | null
}): string => {
  return getConfigDisplayMeta({
    configPath: currentPreset?.config_path ?? configRuntime?.current_config_path,
    name: currentPreset?.name ?? configRuntime?.current_config_name,
    description: currentPreset?.description,
  }).title
}

export const getCurrentConfigDescription = ({
  configRuntime,
  currentPreset,
}: {
  configRuntime?: ConfigRuntimeFromAPI | null
  currentPreset?: ConfigPresetFromAPI | null
}): string => {
  if (
    looksLikeGeneratedRuntimeConfig(configRuntime?.current_config_name) ||
    looksLikeGeneratedRuntimeConfig(configRuntime?.current_config_path)
  ) {
    return 'This backend is running a generated NAT config file, so the original preset could not be confirmed from the current process.'
  }

  return getConfigDisplayMeta({
    configPath: currentPreset?.config_path ?? configRuntime?.current_config_path,
    name: currentPreset?.name ?? configRuntime?.current_config_name,
    description: currentPreset?.description,
  }).summary
}

export const StatusPill = ({
  children,
  tone = 'neutral',
  mono = false,
}: {
  children: ReactNode
  tone?: PillTone
  mono?: boolean
}) => (
  <span
    className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold leading-none ${
      mono ? 'font-mono normal-case tracking-normal' : 'uppercase tracking-[0.08em]'
    } ${PILL_TONE_CLASS_NAMES[tone]}`}
  >
    {children}
  </span>
)

export const CodeDetailBlock = ({
  label,
  value,
}: {
  label: string
  value: string
}) => (
  <div className="rounded-lg border border-black/5 bg-surface-raised px-3 py-2">
    <div className="text-subtle text-[11px] font-semibold uppercase tracking-[0.08em]">{label}</div>
    <code className="mt-1 block break-all text-[12px] leading-5 text-subtle">{value}</code>
  </div>
)

export const EndpointBlock = ({ endpoint }: { endpoint: string }) => (
  <div className="rounded-lg border border-black/5 bg-surface-raised px-3 py-2">
    <div className="text-subtle text-[11px] font-semibold uppercase tracking-[0.08em]">Endpoint</div>
    <code className="mt-1 block break-all text-[12px] leading-5 text-subtle">{endpoint}</code>
  </div>
)

export const SettingPills = ({
  values,
  tone = 'neutral',
}: {
  values: string[]
  tone?: PillTone
}) => {
  if (values.length === 0) {
    return null
  }

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {values.map((value) => (
        <StatusPill key={value} tone={tone} mono>
          {value}
        </StatusPill>
      ))}
    </div>
  )
}

export const useProviderDashboardData = ({
  enabled,
  autoRefreshMs = 0,
}: {
  enabled: boolean
  autoRefreshMs?: number
}) => {
  const { idToken } = useAuth()
  const [providerStatus, setProviderStatus] = useState<ProviderDashboardFromAPI | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadProviderStatus = useCallback(
    async (signal?: AbortSignal, options?: { silent?: boolean }) => {
      if (!options?.silent) {
        setLoading(true)
      }
      setError(null)

      try {
        const client = createProviderStatusClient({ authToken: idToken || undefined })
        const response = await client.getProviderStatus(signal)
        setProviderStatus(response)
      } catch (loadError) {
        if (signal?.aborted) {
          return
        }
        setError(loadError instanceof Error ? loadError.message : 'Failed to load provider status')
      } finally {
        if (!options?.silent) {
          setLoading(false)
        }
      }
    },
    [idToken]
  )

  useEffect(() => {
    if (!enabled) {
      return
    }

    const controller = new AbortController()
    void loadProviderStatus(controller.signal)

    return () => {
      controller.abort()
    }
  }, [enabled, loadProviderStatus])

  useEffect(() => {
    if (!enabled || autoRefreshMs <= 0) {
      return
    }

    const intervalId = window.setInterval(() => {
      void loadProviderStatus(undefined, { silent: true })
    }, autoRefreshMs)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [autoRefreshMs, enabled, loadProviderStatus])

  const sortedProviders = useMemo(() => {
    return [...(providerStatus?.providers ?? [])].sort((left, right) => {
      if (left.active !== right.active) {
        return left.active ? -1 : 1
      }
      return left.name.localeCompare(right.name)
    })
  }, [providerStatus])

  const sortedWorkers = useMemo(() => {
    return [...(providerStatus?.workers ?? [])].sort((left, right) => left.name.localeCompare(right.name))
  }, [providerStatus])

  const presetOptions = useMemo(() => providerStatus?.config_presets ?? [], [providerStatus])

  return {
    providerStatus,
    setProviderStatus,
    loading,
    error,
    loadProviderStatus,
    sortedProviders,
    sortedWorkers,
    presetOptions,
  }
}
