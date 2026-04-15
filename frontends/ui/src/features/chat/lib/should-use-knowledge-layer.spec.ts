// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from 'vitest'
import { shouldUseKnowledgeLayer } from './should-use-knowledge-layer'

describe('shouldUseKnowledgeLayer', () => {
  test('returns false for general prompts with uploaded files present', () => {
    expect(shouldUseKnowledgeLayer('Give me a market overview', ['test.pdf'])).toBe(false)
  })

  test('returns true when the user explicitly references uploaded documents', () => {
    expect(shouldUseKnowledgeLayer('Summarize the uploaded document', ['test.pdf'])).toBe(true)
  })

  test('returns true when the user names a known file', () => {
    expect(shouldUseKnowledgeLayer('What does roadmap-q4.pdf say about hiring?', ['roadmap-q4.pdf'])).toBe(true)
  })

  test('returns true for single-file deictic requests', () => {
    expect(shouldUseKnowledgeLayer('Summarize this', ['briefing.pdf'])).toBe(true)
  })
})
