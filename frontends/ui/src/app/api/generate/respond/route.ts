// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Generate Respond API Route
 *
 * Proxies HITL (human-in-the-loop) prompt responses to the backend.
 * Called by sendPromptResponse() in chat-client.ts when a user
 * approves/rejects an agent prompt.
 *
 * Authentication handling mirrors the parent /api/generate route:
 * - When REQUIRE_AUTH=true: Forwards idToken cookie to backend
 * - When REQUIRE_AUTH=false: Skips all auth info
 */

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { isAuthRequired } from '@/adapters/auth/config'
import { resolveBackendUrl } from '@/adapters/api/backend-url'

const getBackendUrl = (req: Request): string => resolveBackendUrl(req.headers.get('x-aiq-backend-url'))

export async function POST(req: Request): Promise<Response> {
  try {
    const body = await req.json()

    const authRequired = isAuthRequired()
    const authToken = authRequired ? req.headers.get('Authorization') : null

    const cookieStore = await cookies()
    const idToken = authRequired ? cookieStore.get('idToken')?.value : null

    const backendUrl = `${getBackendUrl(req)}/generate/respond`

    const response = await fetch(backendUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: authToken } : {}),
        ...(idToken ? { Cookie: `idToken=${idToken}` } : {}),
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[Generate Respond API] Backend error:', errorText)

      return new NextResponse(
        JSON.stringify({
          error: {
            code: 'BACKEND_ERROR',
            message: `Backend returned ${response.status}: ${errorText}`,
          },
        }),
        {
          status: response.status,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    const data = await response.json().catch(() => ({}))
    return NextResponse.json(data)
  } catch (error) {
    console.error('[Generate Respond API] Proxy error:', error)

    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    return new NextResponse(
      JSON.stringify({
        error: {
          code: 'PROXY_ERROR',
          message: errorMessage,
        },
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}
