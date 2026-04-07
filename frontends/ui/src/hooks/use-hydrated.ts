// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { useSyncExternalStore } from 'react'

const subscribe =
  (_onStoreChange: () => void): (() => void) =>
  () => {}
const getClientSnapshot = (): boolean => true
const getServerSnapshot = (): boolean => false

/**
 * Returns false during SSR and hydration, then true once the client is live.
 * Useful when client-side DOM mutation would otherwise cause hydration mismatch.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot)
}
