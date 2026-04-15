# SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Document management endpoints."""

from datetime import datetime
import logging
import os
import tempfile
from typing import Any

from fastapi import APIRouter
from fastapi import Depends
from fastapi import File
from fastapi import HTTPException
from fastapi import UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from pydantic import Field

from aiq_agent.knowledge import get_available_documents_async
from aiq_agent.knowledge.base import BaseIngestor
from aiq_agent.knowledge.schema import FileInfo
from aiq_agent.knowledge.schema import IngestionJobStatus

from ..models.requests import DeleteFilesRequest
from ..models.requests import UploadResponse
from ..document_storage import delete_stored_documents
from ..document_storage import discard_staged_documents
from ..document_storage import finalize_staged_document
from ..document_storage import get_stored_document
from ..document_storage import stage_uploaded_document
from .collections import _require_ingestor

logger = logging.getLogger(__name__)
_UPLOAD_READ_CHUNK_SIZE = 1024 * 1024
_GENERATED_ARTIFACT_KINDS = {"deep_research_report", "project_memory"}


class DocumentPreviewResponse(BaseModel):
    """Preview metadata for an uploaded document."""

    file_id: str
    file_name: str
    collection_name: str
    status: str
    file_size: int | None = None
    chunk_count: int = 0
    uploaded_at: datetime | None = None
    ingested_at: datetime | None = None
    summary: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


def _is_generated_artifact_file(file_info: FileInfo | None) -> bool:
    if file_info is None:
        return False
    metadata = file_info.metadata if isinstance(file_info.metadata, dict) else {}
    artifact_kind = metadata.get("artifact_kind")
    return isinstance(artifact_kind, str) and artifact_kind in _GENERATED_ARTIFACT_KINDS


def add_document_routes(router: APIRouter):
    """Add document management routes to the FastAPI app."""

    @router.post(
        "/v1/collections/{collection_name}/documents",
        response_model=UploadResponse,
        status_code=202,
        tags=["documents"],
        summary="Upload documents to a collection",
    )
    async def upload_documents(
        collection_name: str,
        files: list[UploadFile] = File(..., description="Files to upload"),
        ingestor: BaseIngestor = Depends(_require_ingestor),
    ) -> UploadResponse:
        """
        Upload documents to a collection.

        Returns a job ID for polling the ingestion status.
        """
        if not files:
            raise HTTPException(status_code=400, detail="No files provided")

        # Verify collection exists
        collection = ingestor.get_collection(collection_name)
        if collection is None:
            raise HTTPException(status_code=404, detail=f"Collection '{collection_name}' not found")

        temp_paths: list[str] = []
        original_filenames: list[str] = []
        staged_uploads: list[str] = []
        try:
            # Save uploaded files to temp location
            # NOTE: Files are NOT deleted here - the ingestion job cleans them up
            # after processing to allow background thread to access them
            for file in files:
                original_filename = file.filename or "unknown"
                original_filenames.append(original_filename)
                suffix = f"_{original_filename}" if original_filename else ""
                temp_path: str | None = None
                try:
                    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                        temp_path = tmp.name
                        temp_paths.append(temp_path)
                        while True:
                            chunk = await file.read(_UPLOAD_READ_CHUNK_SIZE)
                            if not chunk:
                                break
                            tmp.write(chunk)
                        logger.debug("Saved uploaded file to %s", tmp.name)
                finally:
                    try:
                        await file.close()
                    except Exception as close_error:
                        logger.warning(
                            "Failed to close upload handle for %s: %s",
                            original_filename,
                            close_error,
                        )

                staged_uploads.append(
                    stage_uploaded_document(
                        collection_name=collection_name,
                        source_path=temp_path,
                        original_filename=original_filename,
                        content_type=file.content_type,
                    )
                )

            # Submit ingestion job (job will clean up temp files after processing)
            # Pass original filenames so file_details uses correct names
            job_id = ingestor.submit_job(
                temp_paths,
                collection_name,
                config={
                    "cleanup_files": True,
                    "original_filenames": original_filenames,
                },
            )

            # Get the job to extract file_ids for the response
            job_status = ingestor.get_job_status(job_id)
            file_ids = [fd.file_id for fd in job_status.file_details]

            if len(staged_uploads) != len(file_ids):
                logger.warning(
                    "Staged upload count did not match returned file_ids for %s (staged=%s, file_ids=%s)",
                    collection_name,
                    len(staged_uploads),
                    len(file_ids),
                )
                if len(staged_uploads) > len(file_ids):
                    discard_staged_documents(collection_name, staged_uploads[len(file_ids):])

            for staged_upload, file_id in zip(staged_uploads, file_ids):
                try:
                    finalize_staged_document(collection_name, staged_upload, file_id)
                except Exception as storage_error:
                    discard_staged_documents(collection_name, [staged_upload])
                    logger.warning(
                        "Failed to persist original upload for %s/%s: %s",
                        collection_name,
                        file_id,
                        storage_error,
                    )

            logger.info(f"Submitted ingestion job {job_id} for {len(files)} file(s)")

            return UploadResponse(
                job_id=job_id,
                file_ids=file_ids,
                message=f"Ingestion job submitted for {len(files)} file(s)",
            )

        except HTTPException:
            # Clean up on HTTP errors (job not submitted)
            for path in temp_paths:
                try:
                    os.unlink(path)
                except OSError:
                    pass
            if staged_uploads:
                discard_staged_documents(collection_name, staged_uploads)
            raise
        except Exception as e:
            # Clean up on other errors (job not submitted)
            for path in temp_paths:
                try:
                    os.unlink(path)
                except OSError:
                    pass
            if staged_uploads:
                discard_staged_documents(collection_name, staged_uploads)
            logger.error(f"Failed to upload documents: {e}")
            raise HTTPException(status_code=500, detail=str(e))
        finally:
            for file in files:
                try:
                    await file.close()
                except Exception:
                    pass

    @router.get(
        "/v1/collections/{collection_name}/documents",
        response_model=list[FileInfo],
        tags=["documents"],
        summary="List documents in a collection",
    )
    async def list_documents(
        collection_name: str,
        ingestor: BaseIngestor = Depends(_require_ingestor),
    ) -> list[FileInfo]:
        """List all documents in a collection."""
        # Verify collection exists
        collection = ingestor.get_collection(collection_name)
        if collection is None:
            raise HTTPException(status_code=404, detail=f"Collection '{collection_name}' not found")

        try:
            return [file_info for file_info in ingestor.list_files(collection_name) if not _is_generated_artifact_file(file_info)]
        except Exception as e:
            logger.error(f"Failed to list documents: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @router.get(
        "/v1/collections/{collection_name}/documents/{file_id}/preview",
        response_model=DocumentPreviewResponse,
        tags=["documents"],
        summary="Get document preview metadata",
    )
    async def get_document_preview(
        collection_name: str,
        file_id: str,
        ingestor: BaseIngestor = Depends(_require_ingestor),
    ) -> DocumentPreviewResponse:
        """Return a lightweight preview for a document in a collection."""
        collection = ingestor.get_collection(collection_name)
        if collection is None:
            raise HTTPException(status_code=404, detail=f"Collection '{collection_name}' not found")

        try:
            file_info = ingestor.get_file_status(file_id, collection_name)
            if file_info is None:
                files = ingestor.list_files(collection_name)
                file_info = next(
                    (item for item in files if item.file_id == file_id or item.file_name == file_id),
                    None,
                )

            if file_info is None:
                raise HTTPException(status_code=404, detail=f"Document '{file_id}' not found")
            if _is_generated_artifact_file(file_info):
                raise HTTPException(status_code=404, detail=f"Document '{file_id}' not found")

            summary = None
            metadata = dict(file_info.metadata or {})
            if isinstance(metadata.get("summary"), str):
                summary = metadata["summary"]
            else:
                for document in await get_available_documents_async(collection_name):
                    if document.file_name == file_info.file_name:
                        summary = document.summary
                        break
                if summary:
                    metadata["summary"] = summary

            status = file_info.status.value if hasattr(file_info.status, "value") else str(file_info.status)
            return DocumentPreviewResponse(
                file_id=file_info.file_id or file_info.file_name,
                file_name=file_info.file_name,
                collection_name=file_info.collection_name,
                status=status,
                file_size=file_info.file_size,
                chunk_count=file_info.chunk_count,
                uploaded_at=file_info.uploaded_at,
                ingested_at=file_info.ingested_at,
                summary=summary,
                metadata=metadata,
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Failed to get document preview for {collection_name}/{file_id}: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @router.get(
        "/v1/collections/{collection_name}/documents/{file_id}/download",
        tags=["documents"],
        summary="Download the original uploaded document",
    )
    async def download_document(
        collection_name: str,
        file_id: str,
        ingestor: BaseIngestor = Depends(_require_ingestor),
    ) -> FileResponse:
        """Download the original uploaded document for a collection."""
        collection = ingestor.get_collection(collection_name)
        if collection is None:
            raise HTTPException(status_code=404, detail=f"Collection '{collection_name}' not found")

        try:
            stored_document = get_stored_document(collection_name, file_id)
            if stored_document is None:
                file_info = ingestor.get_file_status(file_id, collection_name)
                if file_info is not None:
                    stored_document = get_stored_document(collection_name, file_info.file_name)
                if stored_document is None:
                    raise HTTPException(
                        status_code=404,
                        detail="Original uploaded file is not available for download",
                    )

            return FileResponse(
                path=stored_document.content_path,
                media_type=stored_document.content_type or "application/octet-stream",
                filename=stored_document.original_filename,
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Failed to download document for {collection_name}/{file_id}: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @router.delete(
        "/v1/collections/{collection_name}/documents",
        tags=["documents"],
        summary="Delete files from a collection",
    )
    async def delete_files(
        collection_name: str,
        request: DeleteFilesRequest,
        ingestor: BaseIngestor = Depends(_require_ingestor),
    ) -> dict[str, Any]:
        """Delete files from a collection by ID."""
        # Verify collection exists
        collection = ingestor.get_collection(collection_name)
        if collection is None:
            raise HTTPException(status_code=404, detail=f"Collection '{collection_name}' not found")

        if not request.file_ids:
            return {
                "message": "No file IDs provided",
                "successful": [],
                "failed": [],
                "total_deleted": 0,
            }

        try:
            result = ingestor.delete_files(request.file_ids, collection_name)
            total_deleted = result.get("total_deleted", 0)
            failed = result.get("failed", [])
            successful_ids = result.get("successful", [])

            if successful_ids:
                delete_stored_documents(collection_name, successful_ids)

            if failed:
                result["message"] = "Some files could not be deleted"
            elif total_deleted == 0:
                result["message"] = "No matching files found"
            else:
                result["message"] = f"Successfully deleted {total_deleted} file(s)"

            return result
        except Exception as e:
            logger.error(f"Failed to delete files from {collection_name}: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @router.get(
        "/v1/documents/{job_id}/status",
        response_model=IngestionJobStatus,
        tags=["documents"],
        summary="Get ingestion job status",
    )
    async def get_job_status(
        job_id: str,
        ingestor: BaseIngestor = Depends(_require_ingestor),
    ) -> IngestionJobStatus:
        """Get the status of an ingestion job."""
        try:
            status = ingestor.get_job_status(job_id)
            if status is None:
                raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")

            return status
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Failed to get job status: {e}")
            raise HTTPException(status_code=500, detail=str(e))
