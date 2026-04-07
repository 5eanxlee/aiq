// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Health Proxy Route
 *
 * Proxies GET /api/health to the backend's /health endpoint.
 * This allows client-side code to check backend health via same-origin
 * requests, which is required in K8s when the backend is not publicly exposed.
 */

import { NextResponse } from 'next/server'
import { resolveBackendUrl } from '@/adapters/api/backend-url'

const getBackendUrl = (req: Request): string => resolveBackendUrl(req.headers.get('x-aiq-backend-url'))

export async function GET(req: Request): Promise<Response> {
  try {
    const response = await fetch(`${getBackendUrl(req)}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      return new NextResponse(null, { status: response.status })
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch {
    return new NextResponse(null, { status: 502 })
  }
}
