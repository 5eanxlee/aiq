// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import type { Conversation } from '../types'

type CollectionConversation = Pick<
  Conversation,
  'id' | 'knowledgeCollectionName' | 'knowledgeCollectionNameOverride'
>

export const resolveKnowledgeCollectionName = (
  conversation?: CollectionConversation | null,
  projectCollectionName?: string | null
): string | undefined =>
  conversation?.knowledgeCollectionNameOverride ??
  conversation?.knowledgeCollectionName ??
  projectCollectionName ??
  conversation?.id
