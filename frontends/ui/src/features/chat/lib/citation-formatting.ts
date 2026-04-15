// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

export interface CitationLike {
  url: string
  title?: string | null
  domain?: string | null
  displayLabel?: string | null
}

export interface MergeableCitation extends CitationLike {
  content: string
  isCited?: boolean
}

const REFERENCE_SECTION_RE =
  /^(?:#{2,3}\s+(?:Sources|References)|Reference\s+List|\*\*References:?\*\*)/im
const CITATION_LINE_RE = /^\s*[-*]?\s*\[(\d+)\]\s*(.+)$/gm
const INLINE_CITATION_RE = /\[\[(\d+)\]\]\((https?:\/\/[^\s)]+)\)/g
const URL_RE = /https?:\/\/\S+/i
const ESCAPED_URL_SUFFIX_RE = /(?:\\(?:n|r|t|u[0-9a-fA-F]{4}))+.*$/i

export const CITATION_LABEL_MAX_LENGTH = 36

const trimTrailingUrlPunctuation = (url: string): string => url.replace(/[.,;)\]]+$/, '')

const cleanExtractedUrl = (url: string): string => {
  const withoutEscapedSuffix = url.trim().replace(ESCAPED_URL_SUFFIX_RE, '')
  const firstToken = withoutEscapedSuffix.split(/\s+/)[0] ?? withoutEscapedSuffix
  return trimTrailingUrlPunctuation(firstToken).replace(/[}"'>]+$/, '')
}

const normalizeUrl = (url: string): string => {
  try {
    const parsed = new URL(cleanExtractedUrl(url))
    parsed.hash = ''
    if (parsed.pathname !== '/') {
      parsed.pathname = parsed.pathname.replace(/\/+$/, '')
    }
    return parsed.toString()
  } catch {
    return url
  }
}

const truncateLabel = (label: string, maxLength = CITATION_LABEL_MAX_LENGTH): string => {
  const trimmed = label.trim().replace(/\s+/g, ' ')
  if (trimmed.length <= maxLength) {
    return trimmed
  }
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`
}

export const getCitationDomain = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

const buildUrlPreview = (url: string, providedDomain?: string | null): string => {
  try {
    const parsed = new URL(url)
    const domain = providedDomain || parsed.hostname.replace(/^www\./, '')
    const path = parsed.pathname.replace(/\/+$/, '')
    if (!path || path === '/') {
      return domain
    }
    return `${domain}${path}`
  } catch {
    return url
  }
}

const stripMarkdownFormatting = (value: string): string =>
  value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const extractReferenceLabel = (referenceText: string, url: string): string | null => {
  const cleanedUrl = trimTrailingUrlPunctuation(url)
  const textWithoutUrl = stripMarkdownFormatting(referenceText)
    .replace(cleanedUrl, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s*[-:|]+\s*$/, '')
    .trim()

  return textWithoutUrl ? textWithoutUrl : null
}

export const buildCitationDisplayLabel = (
  citation: CitationLike,
  maxLength = CITATION_LABEL_MAX_LENGTH
): string => {
  if (citation.displayLabel) {
    return truncateLabel(citation.displayLabel, maxLength)
  }
  if (citation.title) {
    return truncateLabel(citation.title, maxLength)
  }
  return truncateLabel(buildUrlPreview(citation.url, citation.domain), maxLength)
}

export const extractReferencedUrlsFromMarkdown = (markdown: string): Set<string> => {
  const referencedUrls = new Set<string>()
  if (!markdown.trim()) {
    return referencedUrls
  }

  const matches = markdown.match(/https?:\/\/[^\s<>"')\]}]+/g) ?? []
  for (const match of matches) {
    referencedUrls.add(normalizeUrl(cleanExtractedUrl(match)))
  }

  return referencedUrls
}

export const mergeDeepResearchCitations = <T extends MergeableCitation>(
  citations: T[],
  reportMarkdown = ''
): T[] => {
  const referencedUrls = extractReferencedUrlsFromMarkdown(reportMarkdown)
  const merged = new Map<string, T>()

  for (const citation of citations) {
    if (!citation.url) {
      continue
    }

    const normalizedUrl = normalizeUrl(citation.url)
    const existing = merged.get(normalizedUrl)
    const isCited = Boolean(existing?.isCited || citation.isCited || referencedUrls.has(normalizedUrl))

    if (existing) {
      merged.set(normalizedUrl, {
        ...existing,
        ...citation,
        url: cleanExtractedUrl(citation.url),
        content: citation.content || existing.content,
        title: citation.title || existing.title,
        domain: citation.domain || existing.domain,
        displayLabel: citation.displayLabel || existing.displayLabel,
        isCited,
      })
      continue
    }

    merged.set(normalizedUrl, {
      ...citation,
      url: cleanExtractedUrl(citation.url),
      isCited,
    })
  }

  return Array.from(merged.values())
}

export const formatReportMarkdownWithCitations = (
  markdown: string,
  citations: CitationLike[] = []
): string => {
  if (!markdown.trim()) {
    return markdown
  }

  const metadataByUrl = new Map(
    citations.map((citation) => [
      normalizeUrl(citation.url),
      {
        title: citation.title ?? undefined,
        domain: citation.domain ?? undefined,
        displayLabel: citation.displayLabel ?? undefined,
      },
    ])
  )

  const referenceMatch = REFERENCE_SECTION_RE.exec(markdown)
  const body = referenceMatch ? markdown.slice(0, referenceMatch.index).trimEnd() : markdown.trimEnd()
  const referenceSection = referenceMatch ? markdown.slice(referenceMatch.index) : ''

  const referenceHeader = referenceSection ? referenceSection.split('\n')[0]?.trim() ?? '' : ''
  const referenceEntries = Array.from(referenceSection.matchAll(CITATION_LINE_RE)).map((match) => {
    const number = Number(match[1])
    const lineText = match[2]?.trim() ?? ''
    const urlMatch = lineText.match(URL_RE)
    const url = urlMatch ? trimTrailingUrlPunctuation(urlMatch[0]) : ''
    const metadata = metadataByUrl.get(normalizeUrl(url))
    const fallbackLabel = url ? extractReferenceLabel(lineText, url) : stripMarkdownFormatting(lineText)
    const label = buildCitationDisplayLabel({
      url,
      title: metadata?.title ?? fallbackLabel,
      domain: metadata?.domain,
      displayLabel: metadata?.displayLabel,
    })

    return { number, url, label }
  })

  const formattedBody = body.replace(INLINE_CITATION_RE, (_match, numberText: string, url: string) => {
    return `[[${numberText}]](${url})`
  })

  if (!referenceHeader || referenceEntries.length === 0) {
    return formattedBody
  }

  const formattedReferences = referenceEntries.map((entry) =>
    entry.url ? `${entry.number}. [${entry.label}](${entry.url})` : `${entry.number}. ${entry.label}`
  )

  return `${formattedBody}\n\n${referenceHeader}\n\n${formattedReferences.join('\n')}\n`
}
