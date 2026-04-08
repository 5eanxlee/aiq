// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

'use client'

import { type FC, useCallback, useRef, useState } from 'react'
import { Banner, Button, Flex, SidePanel, Text } from '@/adapters/ui'
import { ChartFlow, Refresh } from '@/adapters/ui/icons'
import { formatTime } from '@/shared/utils/format-time'
import {
  EndpointBlock,
  formatCapabilityLabel,
  formatQuotaSummary,
  getModelSettingParts,
  getObservedModelsSummary,
  getStatusLabel,
  SettingPills,
  StatusPill,
  toneForProviderStatus,
  useProviderDashboardData,
} from '../provider-dashboard'
import { useLayoutStore } from '../store'
import type { ProviderStatusFromAPI, RuntimeModelObservationFromAPI, WorkerStatusFromAPI } from '@/adapters/api'

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

const ProviderRow = ({ provider }: { provider: ProviderStatusFromAPI }) => {
  const observedModelsSummary = getObservedModelsSummary(provider)

  return (
    <div
      className="border-base border-b py-4 first:border-t"
      data-testid={`provider-status-${provider.id}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Text kind="label/semibold/sm" className="block text-primary">
            {provider.name}
          </Text>
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${
            provider.status === 'ready' ? 'bg-emerald-500' :
            provider.status === 'error' ? 'bg-red-500' :
            provider.status === 'limited' || provider.status === 'missing_config' ? 'bg-amber-500' :
            'bg-black/20 dark:bg-white/20'
          }`} />
        </div>
        <StatusPill tone={toneForProviderStatus(provider)}>{getStatusLabel(provider)}</StatusPill>
      </div>

      <Text kind="body/regular/xs" className="mt-1.5 block text-subtle leading-5">
        {formatQuotaSummary(provider)}
      </Text>

      {provider.detail && (
        <Text kind="body/regular/xs" className="mt-1.5 block text-subtle/70 leading-5">
          {provider.detail}
        </Text>
      )}

      {provider.features.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1">
          {provider.features.map((feature) => (
            <span key={feature} className="text-[10px] font-semibold uppercase tracking-[0.08em] text-subtle">
              {formatCapabilityLabel(feature)}
            </span>
          ))}
        </div>
      )}

      {(observedModelsSummary || provider.models.length > 0) && (
        <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1">
          {(observedModelsSummary ?? provider.models.join(', ')).split(', ').map((model) => (
            <code key={model} className="text-[11px] leading-5 text-subtle">{model}</code>
          ))}
        </div>
      )}

      {provider.endpoints.length > 0 && (
        <div className="mt-2.5 grid gap-2">
          {provider.endpoints.map((endpoint) => (
            <EndpointBlock key={`${provider.id}-${endpoint}`} endpoint={endpoint} />
          ))}
        </div>
      )}
    </div>
  )
}

const RuntimeObservationRow = ({
  call,
}: {
  call: RuntimeModelObservationFromAPI
}) => (
  <div className="border-base border-b py-2 last:border-b-0">
    <div className="flex items-center justify-between gap-2">
      <code className="block break-all text-[12px] leading-5 text-primary">{call.model_name}</code>
      <span className="shrink-0 text-[10px] font-semibold tabular-nums text-subtle">
        {call.call_count} call{call.call_count === 1 ? '' : 's'}
      </span>
    </div>
    <Text kind="body/regular/xs" className="mt-0.5 block text-subtle/70 leading-5">
      {typeof call.total_tokens === 'number' ? `${call.total_tokens.toLocaleString()} tokens` : ''}
      {typeof call.total_tokens === 'number' && call.last_seen_at ? ' · ' : ''}
      {call.last_seen_at ? `last ${formatTime(call.last_seen_at)}` : ''}
    </Text>
  </div>
)

const WorkerRow = ({ worker }: { worker: WorkerStatusFromAPI }) => (
  <div
    className="border-base border-b py-4 first:border-t"
    data-testid={`worker-status-${worker.id}`}
  >
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <Text kind="label/semibold/sm" className="block text-primary">
          {worker.name}
        </Text>
        {worker.runtime_calls.length > 0 && (
          <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-emerald-600 dark:text-emerald-400">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Observed
          </span>
        )}
      </div>
      {worker.last_runtime_at && (
        <span className="shrink-0 text-[11px] tabular-nums text-subtle">
          {formatTime(worker.last_runtime_at)}
        </span>
      )}
    </div>

    {worker.llms.length > 0 ? (
      <div className="mt-2.5 space-y-2">
        {worker.llms.map((llm) => (
          <div
            key={`${worker.id}-${llm.role}-${llm.llm_ref}`}
            className="border-base border-l-2 pl-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-primary">
                {llm.role}
              </span>
              {llm.provider_id && (
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-subtle">
                  {llm.provider_id}
                </span>
              )}
            </div>
            <code className="mt-1 block break-all text-[12px] leading-5 text-primary">
              {llm.model_name ?? llm.llm_ref}
            </code>
            <SettingPills values={getModelSettingParts(llm)} />
            {llm.endpoint && (
              <div className="mt-2">
                <EndpointBlock endpoint={llm.endpoint} />
              </div>
            )}
          </div>
        ))}
      </div>
    ) : (
      <Text kind="body/regular/xs" className="mt-2 block text-subtle">
        No configured models reported.
      </Text>
    )}

    {worker.runtime_calls.length > 0 && (
      <div className="mt-3 border-t border-black/5 pt-2 dark:border-white/5">
        <Text kind="label/semibold/xs" className="text-subtle uppercase tracking-[0.08em]">
          Runtime Calls
        </Text>
        <div className="mt-1.5">
          {worker.runtime_calls.map((call) => (
            <RuntimeObservationRow key={`${worker.id}-${call.model_name}-${call.last_seen_at}`} call={call} />
          ))}
        </div>
      </div>
    )}
  </div>
)

export const ProvidersPanel: FC = () => {
  const { rightPanel, closeRightPanel, openRightPanel } = useLayoutStore()
  const isOpen = rightPanel === 'providers'
  const { providerStatus, loading, error, loadProviderStatus, sortedProviders, sortedWorkers } =
    useProviderDashboardData({
      enabled: isOpen,
      autoRefreshMs: 10000,
    })
  const { width: panelWidth, onMouseDown: onResizeMouseDown } = useResizableWidth(DEFAULT_PANEL_WIDTH)

  return (
    <SidePanel
      className="bg-surface-base top-[var(--header-height)] h-[calc(100vh-var(--header-height))] rounded-l-2xl"
      style={{ width: panelWidth }}
      open={isOpen}
      onOpenChange={(open) => {
        if (open) {
          openRightPanel('providers')
        } else {
          closeRightPanel()
        }
      }}
      side="right"
      bordered
      closeOnClickOutside={false}
      slotHeading={
        <Flex align="center" gap="2">
          <ChartFlow className="h-5 w-5" />
          Research Providers
        </Flex>
      }
      slotFooter={
        providerStatus?.generated_at ? (
          <Text kind="body/regular/xs" className="text-subtle">
            Last checked at {formatTime(providerStatus.generated_at)}.
          </Text>
        ) : null
      }
    >
      {/* Resize handle */}
      <div
        onMouseDown={onResizeMouseDown}
        className="absolute left-0 top-0 z-10 h-full w-1 cursor-col-resize hover:bg-primary/10 active:bg-primary/20"
      />

      <Flex direction="col" gap="6">
        <Flex align="center" justify="between">
          <Text kind="label/semibold/xs" className="text-subtle uppercase tracking-[0.08em]">
            Runtime Readiness
          </Text>
          <Button
            kind="tertiary"
            size="small"
            onClick={() => void loadProviderStatus()}
            disabled={loading}
            aria-label="Refresh provider status"
          >
            <Refresh className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </Flex>

        {providerStatus && (
          <div className={`flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] ${
            providerStatus.can_run_research
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-amber-600 dark:text-amber-400'
          }`}>
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${
              providerStatus.can_run_research ? 'bg-emerald-500' : 'bg-amber-500'
            }`} />
            {providerStatus.can_run_research
              ? 'All providers ready'
              : providerStatus.missing_requirements.join(' ')}
          </div>
        )}

        {loading ? (
          <Text kind="body/regular/xs" className="text-subtle">
            Loading provider status...
          </Text>
        ) : error ? (
          <Flex direction="col" gap="2">
            <Text kind="body/regular/xs" className="text-error">
              {error}
            </Text>
            <Button kind="secondary" size="small" onClick={() => void loadProviderStatus()}>
              Retry
            </Button>
          </Flex>
        ) : (
          <>
            <Flex direction="col" gap="0">
              <Text kind="label/semibold/xs" className="mb-1 text-subtle uppercase tracking-[0.08em]">
                Providers
              </Text>
              {sortedProviders.length > 0 ? (
                <div>
                  {sortedProviders.map((provider) => (
                    <ProviderRow key={provider.id} provider={provider} />
                  ))}
                </div>
              ) : (
                <Text kind="body/regular/xs" className="py-3 text-subtle">
                  No providers detected.
                </Text>
              )}
            </Flex>

            <div className="border-base border-t" />

            <Flex direction="col" gap="0">
              <Text kind="label/semibold/xs" className="mb-1 text-subtle uppercase tracking-[0.08em]">
                Worker Models
              </Text>
              {sortedWorkers.length > 0 ? (
                <div>
                  {sortedWorkers.map((worker) => (
                    <WorkerRow key={worker.id} worker={worker} />
                  ))}
                </div>
              ) : (
                <Text kind="body/regular/xs" className="py-3 text-subtle">
                  No workers detected.
                </Text>
              )}
            </Flex>
          </>
        )}
      </Flex>
    </SidePanel>
  )
}
