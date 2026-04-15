// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

const DOCUMENT_REFERENCE_PATTERNS = [
  /\b(my|our)\s+(files?|docs?|documents?|pdfs?)\b/i,
  /\b(uploaded|attached|project)\s+(files?|docs?|documents?|pdfs?)\b/i,
  /\b(this|these|that|those)\s+(files?|docs?|documents?|pdfs?)\b/i,
  /\b(from|in|within|using|based on|according to)\s+(the\s+)?(files?|docs?|documents?|pdfs?)\b/i,
  /\b(summarize|summarise|analy[sz]e|review|read|quote|extract|cite|compare|explain|check|inspect|look(?:\s+at|\s+through)?)\b.*\b(files?|docs?|documents?|pdfs?)\b/i,
  /\b(files?|docs?|documents?|pdfs?)\b.*\b(say|show|contain|mention|cover|describe|explain)\b/i,
]

const SINGLE_FILE_REFERENCE_PATTERNS = [
  /\b(summarize|summarise|analy[sz]e|review|read|quote|extract|cite|explain)\s+(this|that|it)\b/i,
  /\bwhat does\s+(this|that|it)\s+(say|show|contain|mean)\b/i,
  /\bwhat is in\s+(this|that|it)\b/i,
]

const normalizeText = (value: string): string => value.toLowerCase().replace(/\s+/g, ' ').trim()

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const containsWholePhrase = (message: string, phrase: string): boolean =>
  new RegExp(`(^|\\b)${escapeRegExp(phrase)}(\\b|$)`, 'i').test(message)

const referencesKnownFile = (message: string, fileName: string): boolean => {
  const normalizedFileName = normalizeText(fileName)
  if (!normalizedFileName) {
    return false
  }

  if (containsWholePhrase(message, normalizedFileName)) {
    return true
  }

  const baseName = normalizedFileName.replace(/\.[a-z0-9]{1,6}$/i, '')
  const normalizedBaseName = baseName.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()

  if (
    normalizedBaseName &&
    (/[ _-]/.test(baseName) || normalizedBaseName.length >= 12) &&
    containsWholePhrase(message, normalizedBaseName)
  ) {
    return true
  }

  return false
}

export const shouldUseKnowledgeLayer = (message: string, fileNames: string[]): boolean => {
  const normalizedMessage = normalizeText(message)
  if (!normalizedMessage) {
    return false
  }

  if (DOCUMENT_REFERENCE_PATTERNS.some((pattern) => pattern.test(normalizedMessage))) {
    return true
  }

  if (
    fileNames.length === 1 &&
    SINGLE_FILE_REFERENCE_PATTERNS.some((pattern) => pattern.test(normalizedMessage))
  ) {
    return true
  }

  return fileNames.some((fileName) => referencesKnownFile(normalizedMessage, fileName))
}
