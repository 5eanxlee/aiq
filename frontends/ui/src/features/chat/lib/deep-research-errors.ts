// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

export const isUnavailableDeepResearchJobError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false
  return /(?:404|410)|expired|deleted|not found/i.test(error.message)
}

export const isTransientDeepResearchTransportError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false
  return /(?:\b5\d{2}\b)|fetch failed|network error|econnreset|socket hang up|timed out|proxy_error|backend_error/i.test(
    error.message
  )
}
