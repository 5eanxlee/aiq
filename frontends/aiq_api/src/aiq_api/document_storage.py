# SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Local storage helpers for uploaded source files."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import uuid


_DOCUMENT_STORAGE_ENV = "AIQ_DOCUMENT_STORAGE_DIR"
_DEFAULT_DOCUMENT_STORAGE_DIR = "./var/document_uploads"
_CONTENT_FILE_NAME = "content"
_METADATA_FILE_NAME = "metadata.json"
_PENDING_DIR_NAME = "_pending"


@dataclass(frozen=True)
class StoredDocument:
    """A locally persisted uploaded file."""

    collection_name: str
    file_id: str | None
    original_filename: str
    content_type: str | None
    content_path: Path
    metadata: dict[str, object]


def _safe_component(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _storage_root(create: bool = True) -> Path:
    root = Path(os.environ.get(_DOCUMENT_STORAGE_ENV, _DEFAULT_DOCUMENT_STORAGE_DIR)).expanduser()
    if create:
        root.mkdir(parents=True, exist_ok=True)
    return root


def _collection_dir(collection_name: str, create: bool = True) -> Path:
    path = _storage_root(create=create) / _safe_component(collection_name)
    if create:
        path.mkdir(parents=True, exist_ok=True)
    return path


def _document_dir(collection_name: str, file_id: str) -> Path:
    return _collection_dir(collection_name, create=False) / _safe_component(file_id)


def _pending_root(collection_name: str, create: bool = True) -> Path:
    path = _collection_dir(collection_name, create=create) / _PENDING_DIR_NAME
    if create:
        path.mkdir(parents=True, exist_ok=True)
    return path


def _pending_upload_dir(collection_name: str, pending_id: str, create: bool = True) -> Path:
    path = _pending_root(collection_name, create=create) / pending_id
    if create:
        path.mkdir(parents=True, exist_ok=True)
    return path


def _metadata_path(directory: Path) -> Path:
    return directory / _METADATA_FILE_NAME


def _content_path(directory: Path) -> Path:
    return directory / _CONTENT_FILE_NAME


def _write_metadata(directory: Path, metadata: dict[str, object]) -> None:
    _metadata_path(directory).write_text(json.dumps(metadata, ensure_ascii=True, indent=2), encoding="utf-8")


def _read_metadata(directory: Path) -> dict[str, object] | None:
    metadata_path = _metadata_path(directory)
    if not metadata_path.exists():
        return None

    try:
        raw = json.loads(metadata_path.read_text(encoding="utf-8"))
    except Exception:
        return None

    return raw if isinstance(raw, dict) else None


def stage_uploaded_document(
    collection_name: str,
    source_path: str | Path,
    original_filename: str,
    content_type: str | None,
) -> str:
    """Copy an uploaded file into local pending storage before ingestion cleanup runs."""

    pending_id = uuid.uuid4().hex
    directory = _pending_upload_dir(collection_name, pending_id)
    shutil.copy2(source_path, _content_path(directory))
    _write_metadata(
        directory,
        {
            "collection_name": collection_name,
            "file_id": None,
            "original_filename": original_filename,
            "content_type": content_type,
            "stored_at": datetime.now(UTC).isoformat(),
        },
    )
    return pending_id


def finalize_staged_document(collection_name: str, pending_id: str, file_id: str) -> None:
    """Promote a staged upload to its final file_id-backed location."""

    source_directory = _pending_upload_dir(collection_name, pending_id, create=False)
    if not source_directory.exists():
        raise FileNotFoundError(f"Pending upload '{pending_id}' was not found")

    target_directory = _document_dir(collection_name, file_id)
    if target_directory.exists():
        shutil.rmtree(target_directory)

    target_directory.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(source_directory), str(target_directory))

    metadata = _read_metadata(target_directory) or {}
    metadata["file_id"] = file_id
    metadata["collection_name"] = collection_name
    _write_metadata(target_directory, metadata)

    pending_root = _pending_root(collection_name, create=False)
    if pending_root.exists() and not any(pending_root.iterdir()):
        pending_root.rmdir()


def discard_staged_documents(collection_name: str, pending_ids: list[str]) -> None:
    """Remove staged uploads that were never finalized."""

    for pending_id in pending_ids:
        directory = _pending_upload_dir(collection_name, pending_id, create=False)
        if directory.exists():
            shutil.rmtree(directory, ignore_errors=True)

    pending_root = _pending_root(collection_name, create=False)
    if pending_root.exists() and not any(pending_root.iterdir()):
        pending_root.rmdir()


def get_stored_document(collection_name: str, file_identifier: str) -> StoredDocument | None:
    """Resolve a stored upload by file_id, falling back to original filename."""

    direct_directory = _document_dir(collection_name, file_identifier)
    direct_document = _load_stored_document(collection_name, direct_directory)
    if direct_document is not None:
        return direct_document

    collection_directory = _collection_dir(collection_name, create=False)
    if not collection_directory.exists():
        return None
    matches: list[tuple[float, StoredDocument]] = []
    for child in collection_directory.iterdir():
        if child.name == _PENDING_DIR_NAME or not child.is_dir():
            continue

        document = _load_stored_document(collection_name, child)
        if document is None:
            continue

        if document.file_id == file_identifier or document.original_filename == file_identifier:
            try:
                modified_at = document.content_path.stat().st_mtime
            except OSError:
                modified_at = 0.0
            matches.append((modified_at, document))

    if not matches:
        return None

    matches.sort(key=lambda item: item[0], reverse=True)
    return matches[0][1]


def delete_stored_documents(collection_name: str, file_identifiers: list[str]) -> None:
    """Delete persisted uploads for the provided file identifiers."""

    collection_directory = _collection_dir(collection_name, create=False)
    if not collection_directory.exists():
        return
    for file_identifier in file_identifiers:
        direct_directory = _document_dir(collection_name, file_identifier)
        if direct_directory.exists():
            shutil.rmtree(direct_directory, ignore_errors=True)
            continue

        for child in collection_directory.iterdir():
            if child.name == _PENDING_DIR_NAME or not child.is_dir():
                continue

            metadata = _read_metadata(child) or {}
            if metadata.get("file_id") == file_identifier or metadata.get("original_filename") == file_identifier:
                shutil.rmtree(child, ignore_errors=True)


def delete_stored_collection(collection_name: str) -> None:
    """Delete every persisted upload for a collection."""

    collection_directory = _collection_dir(collection_name, create=False)
    if collection_directory.exists():
        shutil.rmtree(collection_directory, ignore_errors=True)


def _load_stored_document(collection_name: str, directory: Path) -> StoredDocument | None:
    if not directory.exists() or not directory.is_dir():
        return None

    content_path = _content_path(directory)
    metadata = _read_metadata(directory)
    if metadata is None or not content_path.exists():
        return None

    original_filename = metadata.get("original_filename")
    if not isinstance(original_filename, str) or not original_filename.strip():
        return None

    file_id = metadata.get("file_id")
    content_type = metadata.get("content_type")
    return StoredDocument(
        collection_name=collection_name,
        file_id=file_id if isinstance(file_id, str) else None,
        original_filename=original_filename,
        content_type=content_type if isinstance(content_type, str) else None,
        content_path=content_path,
        metadata=metadata,
    )
