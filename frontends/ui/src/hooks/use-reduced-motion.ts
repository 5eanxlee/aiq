// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { useSyncExternalStore } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

const subscribe = (onStoreChange: () => void): (() => void) => {
  const mediaQuery = window.matchMedia(QUERY)
  const handleChange = (): void => {
    onStoreChange()
  }

  mediaQuery.addEventListener('change', handleChange)
  return () => mediaQuery.removeEventListener('change', handleChange)
}

const getSnapshot = (): boolean => window.matchMedia(QUERY).matches
const getServerSnapshot = (): boolean => false

/**
 * Reactively tracks the user's `prefers-reduced-motion` OS/browser setting.
 * Returns `true` when the user prefers reduced motion, `false` otherwise.
 *
 * Returns `false` during SSR/hydration, then subscribes to the browser setting
 * once the client snapshot is available.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
