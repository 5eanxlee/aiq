// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * SettingsPanel Component
 *
 * Right-side panel for application settings.
 * Includes appearance/theme settings and provider readiness status.
 */

'use client'

import { type FC, useCallback, useEffect, useMemo, useState } from 'react'
import { Banner, Button, Flex, SidePanel, Select, Text } from '@/adapters/ui'
import { Refresh, Settings } from '@/adapters/ui/icons'
import { useAuth } from '@/adapters/auth'
import {
  createProviderStatusClient,
  type ProviderDashboardFromAPI,
  type ProviderStatusFromAPI,
  type RuntimeModelObservationFromAPI,
  type WorkerLLMConfigFromAPI,
  type WorkerStatusFromAPI,
} from '@/adapters/api'
import { formatTime } from '@/shared/utils/format-time'
import { useLayoutStore } from '../store'
import type { ThemeMode } from '../types'

const getStatusLabel = (provider: ProviderStatusFromAPI): string => {
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

const getStatusClassName = (provider: ProviderStatusFromAPI): string => {
  switch (provider.status) {
    case 'ready':
      return 'text-green-700 dark:text-green-300'
    case 'limited':
      return 'text-yellow-700 dark:text-yellow-300'
    case 'missing_config':
      return 'text-yellow-700 dark:text-yellow-300'
    case 'error':
      return 'text-error'
    default:
      return 'text-subtle'
  }
}

const formatQuotaSummary = (provider: ProviderStatusFromAPI): string => {
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

const formatModelSettings = (config: {
  temperature?: number | null
  top_p?: number | null
  max_tokens?: number | null
}): string | null => {
  const parts: string[] = []

  if (typeof config.temperature === 'number') {
    parts.push(`temp ${config.temperature}`)
  }
  if (typeof config.top_p === 'number') {
    parts.push(`top_p ${config.top_p}`)
  }
  if (typeof config.max_tokens === 'number') {
    parts.push(`max_tokens ${config.max_tokens.toLocaleString()}`)
  }

  return parts.length > 0 ? parts.join(' · ') : null
}

const formatWorkerConfigSummary = (llm: WorkerLLMConfigFromAPI): string => {
  const model = llm.model_name ?? llm.llm_ref
  const settings = formatModelSettings(llm)
  return settings ? `${model} · ${settings}` : model
}

const formatRuntimeCallSummary = (call: RuntimeModelObservationFromAPI): string => {
  const settings = formatModelSettings(call)
  const pieces = [`${call.call_count} call${call.call_count === 1 ? '' : 's'}`]

  if (typeof call.total_tokens === 'number') {
    pieces.push(`${call.total_tokens.toLocaleString()} tokens`)
  }
  if (settings) {
    pieces.push(settings)
  }

  return pieces.join(' · ')
}

const getObservedModelsSummary = (provider: ProviderStatusFromAPI): string | null => {
  const uniqueModels = Array.from(new Set(provider.runtime_calls.map((call) => call.model_name).filter(Boolean)))
  return uniqueModels.length > 0 ? uniqueModels.join(', ') : null
}

/**
 * Settings panel for application preferences.
 * Opens from the right side of the screen.
 */
export const SettingsPanel: FC = () => {
  const { idToken } = useAuth()
  const { rightPanel, closeRightPanel, openRightPanel, theme, setTheme } = useLayoutStore()
  const [providerStatus, setProviderStatus] = useState<ProviderDashboardFromAPI | null>(null)
  const [providersLoading, setProvidersLoading] = useState(false)
  const [providersError, setProvidersError] = useState<string | null>(null)

  const isOpen = rightPanel === 'settings'

  const loadProviderStatus = useCallback(
    async (signal?: AbortSignal, options?: { silent?: boolean }) => {
      if (!options?.silent) {
        setProvidersLoading(true)
      }
      setProvidersError(null)

      try {
        const client = createProviderStatusClient({ authToken: idToken || undefined })
        const response = await client.getProviderStatus(signal)
        setProviderStatus(response)
      } catch (error) {
        if (signal?.aborted) {
          return
        }
        setProvidersError(
          error instanceof Error ? error.message : 'Failed to load provider status'
        )
      } finally {
        if (!options?.silent) {
          setProvidersLoading(false)
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
    void loadProviderStatus(controller.signal)

    return () => {
      controller.abort()
    }
  }, [isOpen, loadProviderStatus])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const intervalId = window.setInterval(() => {
      void loadProviderStatus(undefined, { silent: true })
    }, 10000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [isOpen, loadProviderStatus])

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        openRightPanel('settings')
      } else {
        closeRightPanel()
      }
    },
    [openRightPanel, closeRightPanel]
  )

  const handleThemeChange = useCallback(
    (value: string) => {
      setTheme(value as ThemeMode)
    },
    [setTheme]
  )

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

  return (
    <SidePanel
      className="bg-surface-base top-[var(--header-height)] h-[calc(100vh-var(--header-height))] w-[400px] rounded-l-2xl"
      open={isOpen}
      onOpenChange={handleOpenChange}
      side="right"
      bordered
      closeOnClickOutside={false}
      slotHeading={
        <Flex align="center" gap="2">
          <Settings className="h-5 w-5" />
          Settings
        </Flex>
      }
      slotFooter={
        <Text kind="body/regular/xs" className="text-subtle">
          Settings are saved automatically.
        </Text>
      }
    >
      {/* Appearance Section */}
      <Flex direction="col" gap="6">
        <Text kind="label/semibold/xs" className="text-subtle uppercase">
          UI Theme Options
        </Text>

        <Select
          value={theme}
          onValueChange={handleThemeChange}
          side="bottom"
          items={[
            { children: 'System Theme (Auto)', value: 'system' },
            { children: 'Light', value: 'light' },
            { children: 'Dark', value: 'dark' },
          ]}
        />

        <Flex direction="col" gap="3">
          <Flex align="center" justify="between">
            <Text kind="label/semibold/xs" className="text-subtle uppercase">
              Research Providers
            </Text>
            <Button
              kind="tertiary"
              size="small"
              onClick={() => void loadProviderStatus()}
              disabled={providersLoading}
              aria-label="Refresh provider status"
            >
              <Refresh className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </Flex>

          {providerStatus && (
            <Banner
              kind="inline"
              status={providerStatus.can_run_research ? 'success' : 'warning'}
              className="px-4 py-3"
            >
              {providerStatus.can_run_research
                ? 'Research is ready to run with the current provider setup.'
                : providerStatus.missing_requirements.join(' ')}
            </Banner>
          )}

          {providersLoading ? (
            <Text kind="body/regular/sm" className="text-subtle">
              Loading provider status...
            </Text>
          ) : providersError ? (
            <Flex direction="col" gap="2">
              <Text kind="body/regular/sm" className="text-error">
                {providersError}
              </Text>
              <Button
                kind="secondary"
                size="small"
                onClick={() => void loadProviderStatus()}
                aria-label="Retry provider status"
              >
                Retry
              </Button>
            </Flex>
          ) : sortedProviders.length > 0 ? (
            <Flex direction="col" gap="3">
              {sortedProviders.map((provider) => (
                <div
                  key={provider.id}
                  className="border-base rounded-xl border px-4 py-3"
                  data-testid={`provider-status-${provider.id}`}
                >
                  <Flex align="start" justify="between" gap="4">
                    <Flex direction="col" gap="1" className="min-w-0">
                      <Text kind="label/semibold/sm" className="text-primary">
                        {provider.name}
                      </Text>
                      <Text kind="body/regular/xs" className="text-subtle">
                        {provider.active ? 'Active in workflow' : 'Configured standby'}
                        {provider.features.length > 0 ? ` · ${provider.features.join(' · ')}` : ''}
                      </Text>
                    </Flex>
                    <Text
                      kind="label/semibold/xs"
                      className={`uppercase ${getStatusClassName(provider)}`}
                    >
                      {getStatusLabel(provider)}
                    </Text>
                  </Flex>

                  {provider.models.length > 0 && (
                    <Text kind="body/regular/xs" className="text-subtle mt-2 line-clamp-2">
                      {provider.models.join(', ')}
                    </Text>
                  )}

                  <Text kind="body/regular/sm" className="mt-3">
                    {formatQuotaSummary(provider)}
                  </Text>

                  {getObservedModelsSummary(provider) && (
                    <Text kind="body/regular/xs" className="text-subtle mt-1">
                      Runtime observed: {getObservedModelsSummary(provider)}
                    </Text>
                  )}

                  {provider.detail && (
                    <Text kind="body/regular/xs" className="text-subtle mt-1">
                      {provider.detail}
                    </Text>
                  )}

                  {provider.endpoints.length > 0 && (
                    <Text kind="body/regular/xs" className="text-subtle mt-1 truncate">
                      {provider.endpoints[0]}
                    </Text>
                  )}
                </div>
              ))}
            </Flex>
          ) : (
            <Text kind="body/regular/sm" className="text-subtle">
              No active API providers detected for the current workflow.
            </Text>
          )}

          {providerStatus && (
            <Flex direction="col" gap="3">
              <Text kind="label/semibold/xs" className="text-subtle uppercase">
                Worker Models
              </Text>
              <Text kind="body/regular/xs" className="text-subtle">
                Runtime observations reflect actual model calls seen in the last{' '}
                {providerStatus.runtime_window_minutes} minutes.
              </Text>

              {sortedWorkers.length > 0 ? (
                <Flex direction="col" gap="3">
                  {sortedWorkers.map((worker: WorkerStatusFromAPI) => (
                    <div
                      key={worker.id}
                      className="border-base rounded-xl border px-4 py-3"
                      data-testid={`worker-status-${worker.id}`}
                    >
                      <Flex align="start" justify="between" gap="4">
                        <Flex direction="col" gap="1" className="min-w-0">
                          <Text kind="label/semibold/sm" className="text-primary">
                            {worker.name}
                          </Text>
                          <Text kind="body/regular/xs" className="text-subtle">
                            {worker.runtime_calls.length > 0 ? 'Runtime observed' : 'Config only'}
                          </Text>
                        </Flex>
                        {worker.last_runtime_at && (
                          <Text kind="body/regular/xs" className="text-subtle">
                            {formatTime(worker.last_runtime_at)}
                          </Text>
                        )}
                      </Flex>

                      <Flex direction="col" gap="2" className="mt-3">
                        {worker.llms.map((llm) => (
                          <div
                            key={`${worker.id}-${llm.role}-${llm.llm_ref}`}
                            className="bg-surface-raised rounded-lg px-3 py-2"
                          >
                            <Text kind="label/semibold/xs" className="text-subtle uppercase">
                              {llm.role}
                            </Text>
                            <Text kind="body/regular/sm" className="mt-1">
                              {formatWorkerConfigSummary(llm)}
                            </Text>
                            {llm.endpoint && (
                              <Text kind="body/regular/xs" className="text-subtle mt-1 truncate">
                                {llm.endpoint}
                              </Text>
                            )}
                          </div>
                        ))}
                      </Flex>

                      {worker.runtime_calls.length > 0 ? (
                        <Flex direction="col" gap="2" className="mt-3">
                          <Text kind="label/semibold/xs" className="text-subtle uppercase">
                            Observed At Runtime
                          </Text>
                          {worker.runtime_calls.map((call) => (
                            <div
                              key={`${worker.id}-${call.model_name}-${call.last_seen_at}`}
                              className="bg-surface-raised rounded-lg px-3 py-2"
                            >
                              <Text kind="body/regular/sm">{call.model_name}</Text>
                              <Text kind="body/regular/xs" className="text-subtle mt-1">
                                {formatRuntimeCallSummary(call)}
                              </Text>
                              {call.endpoint && (
                                <Text kind="body/regular/xs" className="text-subtle mt-1 truncate">
                                  {call.endpoint}
                                </Text>
                              )}
                            </div>
                          ))}
                        </Flex>
                      ) : (
                        <Text kind="body/regular/xs" className="text-subtle mt-3">
                          No runtime model calls observed yet for this worker.
                        </Text>
                      )}
                    </div>
                  ))}
                </Flex>
              ) : (
                <Text kind="body/regular/sm" className="text-subtle">
                  No worker model configuration detected for the current workflow.
                </Text>
              )}
            </Flex>
          )}

          {providerStatus?.generated_at && (
            <Text kind="body/regular/xs" className="text-subtle">
              Last checked at {formatTime(providerStatus.generated_at)}.
            </Text>
          )}
        </Flex>
      </Flex>
    </SidePanel>
  )
}
