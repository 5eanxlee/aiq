// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

const DEFAULT_BACKEND_URL = 'http://localhost:8000'

/**
 * Resolve the backend base URL for server-side proxy routes.
 *
 * In split-process dev mode, the gateway injects the backend URL header so
 * Next.js route handlers do not silently fall back to localhost:8000.
 */
export const resolveBackendUrl = (forwardedUrl?: string | null): string => {
  const url =
    forwardedUrl ||
    process.env.BACKEND_URL ||
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    DEFAULT_BACKEND_URL

  return url.replace(/\/$/, '')
}
