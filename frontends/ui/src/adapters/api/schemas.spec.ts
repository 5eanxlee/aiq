// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from 'vitest'

import { NATIncomingMessageSchema, NATMessageType, WebSocketMessageStatus } from './schemas'

describe('NATIncomingMessageSchema', () => {
  test('accepts error messages that arrive with in_progress status', () => {
    const result = NATIncomingMessageSchema.safeParse({
      type: NATMessageType.ERROR,
      id: 'error-1',
      thread_id: 'default',
      parent_id: 'msg-1',
      conversation_id: 'conv-1',
      status: WebSocketMessageStatus.IN_PROGRESS,
      timestamp: '2026-04-07T18:43:31.497652+00:00',
      content: {
        code: 'workflow_error',
        message: 'AttributeError',
        details: "'list' object has no attribute 'strip'",
      },
    })

    expect(result.success).toBe(true)
  })
})
