// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Shared duration formatting utility.
 *
 * Formats millisecond durations into compact human-readable strings.
 */

export const formatDuration = (durationMs: number): string => {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return '0s'
  }

  const totalSeconds = Math.max(Math.floor(durationMs / 1000), 0)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`
  }
  return `${seconds}s`
}
