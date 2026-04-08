// SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Local browser cache for uploaded source files.
 *
 * Stores uploaded files in IndexedDB so downloads can still work after a refresh
 * even when the backend no longer has the original upload.
 */

'use client'

const DB_NAME = 'aiq-documents-cache'
const STORE_NAME = 'uploaded-files'
const DB_VERSION = 1

interface CachedFileRecord {
  key: string
  collectionName: string
  fileName: string
  file: Blob
  contentType: string
  savedAt: number
}

const buildCacheKey = (collectionName: string, identifier: string): string =>
  `${collectionName}::${identifier}`

const supportsIndexedDb = (): boolean =>
  typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined'

const requestToPromise = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })

const transactionToPromise = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
  })

const openDatabase = async (): Promise<IDBDatabase | null> => {
  if (!supportsIndexedDb()) {
    return null
  }

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'))
  })
}

const putRecord = async (record: CachedFileRecord): Promise<void> => {
  const db = await openDatabase()
  if (!db) {
    return
  }

  try {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put(record)
    await transactionToPromise(transaction)
  } finally {
    db.close()
  }
}

const getRecord = async (key: string): Promise<CachedFileRecord | null> => {
  const db = await openDatabase()
  if (!db) {
    return null
  }

  try {
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const result = await requestToPromise(transaction.objectStore(STORE_NAME).get(key))
    await transactionToPromise(transaction)
    return (result as CachedFileRecord | undefined) ?? null
  } finally {
    db.close()
  }
}

const deleteRecord = async (key: string): Promise<void> => {
  const db = await openDatabase()
  if (!db) {
    return
  }

  try {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).delete(key)
    await transactionToPromise(transaction)
  } finally {
    db.close()
  }
}

const normalizeCachedFile = (record: CachedFileRecord): File => {
  if (record.file instanceof File) {
    return record.file
  }

  return new File([record.file], record.fileName, {
    type: record.contentType || 'application/octet-stream',
    lastModified: record.savedAt,
  })
}

export const cacheUploadedFiles = async (collectionName: string, files: File[]): Promise<void> => {
  try {
    await Promise.all(
      files.map((file) =>
        putRecord({
          key: buildCacheKey(collectionName, file.name),
          collectionName,
          fileName: file.name,
          file,
          contentType: file.type || 'application/octet-stream',
          savedAt: Date.now(),
        })
      )
    )
  } catch {
    // Silently degrade when IndexedDB is unavailable.
  }
}

export const cacheResolvedFile = async (
  collectionName: string,
  file: File,
  serverFileId?: string
): Promise<void> => {
  try {
    await putRecord({
      key: buildCacheKey(collectionName, file.name),
      collectionName,
      fileName: file.name,
      file,
      contentType: file.type || 'application/octet-stream',
      savedAt: Date.now(),
    })

    if (serverFileId) {
      await putRecord({
        key: buildCacheKey(collectionName, serverFileId),
        collectionName,
        fileName: file.name,
        file,
        contentType: file.type || 'application/octet-stream',
        savedAt: Date.now(),
      })
    }
  } catch {
    // Silently degrade when IndexedDB is unavailable.
  }
}

export const linkCachedFileToServerId = async (
  collectionName: string,
  fileName: string,
  serverFileId: string
): Promise<void> => {
  try {
    const byName = await getRecord(buildCacheKey(collectionName, fileName))
    if (!byName) {
      return
    }

    await putRecord({
      key: buildCacheKey(collectionName, serverFileId),
      collectionName,
      fileName: byName.fileName,
      file: byName.file,
      contentType: byName.contentType,
      savedAt: Date.now(),
    })
  } catch {
    // Silently degrade when IndexedDB is unavailable.
  }
}

export const getCachedUploadedFile = async (
  collectionName: string,
  fileIdentifier: string,
  fallbackFileName?: string | null
): Promise<File | null> => {
  try {
    const candidates = [fileIdentifier, fallbackFileName].filter(
      (value): value is string => typeof value === 'string' && value.length > 0
    )

    for (const candidate of candidates) {
      const record = await getRecord(buildCacheKey(collectionName, candidate))
      if (record) {
        return normalizeCachedFile(record)
      }
    }
  } catch {
    // Silently degrade when IndexedDB is unavailable.
  }

  return null
}

export const removeCachedUploadedFiles = async (
  collectionName: string,
  identifiers: Array<string | null | undefined>
): Promise<void> => {
  try {
    const keys = identifiers
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .map((identifier) => buildCacheKey(collectionName, identifier))

    await Promise.all(keys.map((key) => deleteRecord(key)))
  } catch {
    // Silently degrade when IndexedDB is unavailable.
  }
}
