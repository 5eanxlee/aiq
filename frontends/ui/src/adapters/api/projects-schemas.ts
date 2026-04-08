// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Project/session API schemas and types.
 */

import { z } from 'zod'

export const SessionSnapshotFromAPISchema = z.object({
  session_id: z.string(),
  messages: z.array(z.record(z.string(), z.unknown())).default([]),
  enabled_data_source_ids: z.array(z.string()).default([]),
  updated_at: z.string().nullable().optional(),
})

export const SessionFromAPISchema = z.object({
  id: z.string(),
  project_id: z.string(),
  title: z.string(),
  knowledge_collection_name: z.string(),
  knowledge_collection_name_override: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  snapshot: SessionSnapshotFromAPISchema.nullable().optional(),
})

export const ProjectFromAPISchema = z.object({
  id: z.string(),
  owner_id: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  knowledge_collection_name: z.string(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  sessions: z.array(SessionFromAPISchema).default([]),
})

export const ProjectArtifactFromAPISchema = z.object({
  id: z.string(),
  project_id: z.string(),
  session_id: z.string().nullable().optional(),
  kind: z.string(),
  title: z.string(),
  body_markdown: z.string(),
  citation_manifest: z.array(z.record(z.string(), z.unknown())).default([]),
  created_at: z.string().nullable().optional(),
  promoted_to_knowledge: z.boolean().default(false),
})

export type SessionSnapshotFromAPI = z.infer<typeof SessionSnapshotFromAPISchema>
export type SessionFromAPI = z.infer<typeof SessionFromAPISchema>
export type ProjectFromAPI = z.infer<typeof ProjectFromAPISchema>
export type ProjectArtifactFromAPI = z.infer<typeof ProjectArtifactFromAPISchema>

