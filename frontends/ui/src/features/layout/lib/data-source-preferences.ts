// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import type { DataSourceFromAPI } from '@/adapters/api'
import { WEB_SEARCH_SOURCE_ID } from '../data-sources'

export const DATA_SOURCE_PREFERENCES_KEY = 'aiq-enabled-data-source-ids'

const canUseLocalStorage = (): boolean =>
  typeof window !== 'undefined' && typeof localStorage !== 'undefined'

const normalizeDataSourceIds = (ids: readonly string[]): string[] =>
  Array.from(new Set(ids.filter((value): value is string => typeof value === 'string')))

const filterAvailableDataSourceIds = (
  ids: readonly string[],
  sources: DataSourceFromAPI[] | null
): string[] => {
  const normalizedIds = normalizeDataSourceIds(ids)

  if (!sources || sources.length === 0) {
    return normalizedIds
  }

  const availableIds = new Set(sources.map((source) => source.id))
  return normalizedIds.filter((id) => availableIds.has(id))
}

export const loadPreferredDataSourceIds = (): string[] | null => {
  if (!canUseLocalStorage()) {
    return null
  }

  try {
    const raw = localStorage.getItem(DATA_SOURCE_PREFERENCES_KEY)
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? normalizeDataSourceIds(parsed) : null
  } catch {
    return null
  }
}

export const savePreferredDataSourceIds = (ids: string[]): void => {
  if (!canUseLocalStorage()) {
    return
  }

  try {
    localStorage.setItem(DATA_SOURCE_PREFERENCES_KEY, JSON.stringify(normalizeDataSourceIds(ids)))
  } catch {
    // Ignore storage write failures; the in-memory selection still updates.
  }
}

export const clearPreferredDataSourceIds = (): void => {
  if (!canUseLocalStorage()) {
    return
  }

  try {
    localStorage.removeItem(DATA_SOURCE_PREFERENCES_KEY)
  } catch {
    // Ignore storage removal failures.
  }
}

export const getDefaultDataSourceIds = (sources: DataSourceFromAPI[] | null): string[] =>
  normalizeDataSourceIds(
    sources
      ?.filter((source) => source.default_enabled ?? source.id === WEB_SEARCH_SOURCE_ID)
      .map((source) => source.id) ?? []
  )

export const resolvePreferredDataSourceIds = (
  sources: DataSourceFromAPI[] | null,
  fallbackIds?: string[] | null
): string[] => {
  const preferredIds = loadPreferredDataSourceIds()

  if (preferredIds !== null) {
    const validPreferredIds = filterAvailableDataSourceIds(preferredIds, sources)
    if (preferredIds.length > 0 && validPreferredIds.length === 0 && sources?.length) {
      return getDefaultDataSourceIds(sources)
    }

    return validPreferredIds
  }

  if (fallbackIds !== undefined && fallbackIds !== null) {
    const validFallbackIds = filterAvailableDataSourceIds(fallbackIds, sources)
    if (fallbackIds.length > 0 && validFallbackIds.length === 0 && sources?.length) {
      return getDefaultDataSourceIds(sources)
    }

    return validFallbackIds
  }

  return getDefaultDataSourceIds(sources)
}
