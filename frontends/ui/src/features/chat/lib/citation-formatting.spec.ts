// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from 'vitest'

import { mergeDeepResearchCitations } from './citation-formatting'

describe('mergeDeepResearchCitations', () => {
  test('marks matching citations as cited when the final report references their URLs', () => {
    const merged = mergeDeepResearchCitations(
      [
        {
          url: 'https://example.com/article',
          content: 'Example article',
          isCited: false,
          title: 'Example Article',
        },
        {
          url: 'https://example.com/other',
          content: 'Other source',
          isCited: false,
          title: 'Other Source',
        },
      ],
      [
        '# Report',
        '',
        'Claim [1].',
        '',
        '## Sources',
        '[1] Example Article: https://example.com/article',
      ].join('\n')
    )

    expect(merged).toHaveLength(2)
    expect(merged.find((citation) => citation.url === 'https://example.com/article')?.isCited).toBe(
      true
    )
    expect(merged.find((citation) => citation.url === 'https://example.com/other')?.isCited).toBe(
      false
    )
  })

  test('deduplicates repeated citation entries by normalized URL and keeps cited state', () => {
    const merged = mergeDeepResearchCitations([
      {
        url: 'https://example.com/article/',
        content: 'First source payload',
        isCited: false,
        title: 'Older title',
      },
      {
        url: 'https://example.com/article',
        content: 'Second source payload',
        isCited: true,
        title: 'Newest title',
      },
    ])

    expect(merged).toHaveLength(1)
    expect(merged[0]?.content).toBe('Second source payload')
    expect(merged[0]?.title).toBe('Newest title')
    expect(merged[0]?.isCited).toBe(true)
  })

  test('normalizes malformed escaped suffixes so historical citations can match the report', () => {
    const merged = mergeDeepResearchCitations(
      [
        {
          url: 'https://example.com/report\\n\\n4',
          content: 'Malformed stored citation',
          isCited: false,
          title: 'Stored report',
        },
      ],
      '## Sources\n[1] Stored report: https://example.com/report\n'
    )

    expect(merged).toHaveLength(1)
    expect(merged[0]?.url).toBe('https://example.com/report')
    expect(merged[0]?.isCited).toBe(true)
  })
})
