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
"""Paper search tool using Semantic Scholar."""

from __future__ import annotations

import logging
import re
from typing import Any

import aiohttp

logger = logging.getLogger(__name__)

SEMANTIC_SCHOLAR_API_URL = "https://api.semanticscholar.org/graph/v1/paper/search"
_DEFAULT_FIELDS = ",".join(
    (
        "paperId",
        "title",
        "year",
        "url",
        "abstract",
        "citationCount",
        "influentialCitationCount",
        "venue",
        "authors",
        "openAccessPdf",
    )
)
_URL_RE = re.compile(r"https?://[^\s)]+")


class SemanticScholarSearchTool:
    """Search academic papers with Semantic Scholar."""

    def __init__(
        self,
        semantic_scholar_api_key: str | None = None,
        *,
        timeout: int = 30,
        max_results: int = 10,
    ) -> None:
        self.semantic_scholar_api_key = semantic_scholar_api_key
        self.timeout = timeout
        self.max_results = max_results

    def _build_headers(self) -> dict[str, str]:
        headers = {
            "Accept": "application/json",
            "User-Agent": "aiq-semantic-scholar-search/1.0",
        }
        if self.semantic_scholar_api_key:
            headers["x-api-key"] = self.semantic_scholar_api_key
        return headers

    @staticmethod
    def _coerce_year(year: str | int | None) -> str | None:
        if year is None:
            return None
        year_str = str(year).strip()
        return year_str or None

    @staticmethod
    def _truncate_text(text: str, limit: int = 700) -> str:
        text = " ".join(text.split())
        if len(text) <= limit:
            return text
        return text[: limit - 3].rstrip() + "..."

    @staticmethod
    def _extract_open_access_url(paper: dict[str, Any]) -> str | None:
        payload = paper.get("openAccessPdf")
        if not isinstance(payload, dict):
            return None

        url = str(payload.get("url") or "").strip()
        if url:
            return url

        disclaimer = str(payload.get("disclaimer") or "")
        match = _URL_RE.search(disclaimer)
        if not match:
            return None
        return match.group(0).rstrip(".,")

    @staticmethod
    def _format_authors(paper: dict[str, Any]) -> str | None:
        authors = paper.get("authors")
        if not isinstance(authors, list):
            return None

        author_names = [
            str(author.get("name")).strip()
            for author in authors
            if isinstance(author, dict) and author.get("name")
        ]
        if not author_names:
            return None
        if len(author_names) <= 4:
            return ", ".join(author_names)
        return ", ".join(author_names[:4]) + f", +{len(author_names) - 4} more"

    async def _search_semantic_scholar(
        self,
        query: str,
        year: str | int | None = None,
        limit: int = 10,
    ) -> list[dict[str, Any]]:
        params: dict[str, Any] = {
            "query": query,
            "limit": max(int(limit), 1),
            "fields": _DEFAULT_FIELDS,
        }

        year_value = self._coerce_year(year)
        if year_value:
            params["year"] = year_value

        timeout = aiohttp.ClientTimeout(total=self.timeout)
        async with aiohttp.ClientSession(timeout=timeout, headers=self._build_headers()) as session:
            async with session.get(SEMANTIC_SCHOLAR_API_URL, params=params) as response:
                if response.status != 200:
                    text = await response.text()
                    raise Exception(f"Semantic Scholar API error: {response.status} - {text}")
                payload = await response.json()

        results = payload.get("data")
        return results if isinstance(results, list) else []

    @classmethod
    def format_results(cls, results: list[dict[str, Any]]) -> str:
        if not results:
            return "No papers found via Semantic Scholar."

        formatted_papers: list[str] = []
        for index, paper in enumerate(results, 1):
            title = paper.get("title", "Unknown Title")
            year = paper.get("year", "Unknown Year")
            venue = paper.get("venue") or "Unknown Venue"
            citation_count = paper.get("citationCount", 0)
            influential_citations = paper.get("influentialCitationCount", 0)
            abstract = cls._truncate_text(str(paper.get("abstract") or ""))
            authors = cls._format_authors(paper)
            semantic_scholar_url = str(paper.get("url") or "").strip()
            open_access_url = cls._extract_open_access_url(paper)

            paper_lines = [
                f"{index}. **{title}** ({year})",
                f"   - **Venue**: {venue}",
                f"   - **Citations**: {citation_count}",
            ]

            if authors:
                paper_lines.append(f"   - **Authors**: {authors}")
            if influential_citations:
                paper_lines.append(f"   - **Influential Citations**: {influential_citations}")
            if abstract:
                paper_lines.append(f"   - **Abstract**: {abstract}")
            if open_access_url and open_access_url != semantic_scholar_url:
                paper_lines.append(f"   - **Open Access PDF**: {open_access_url}")
            if semantic_scholar_url:
                paper_lines.append(f"   - **Semantic Scholar**: {semantic_scholar_url}")

            formatted_papers.append("\n".join(paper_lines))

        return "\n\n".join(formatted_papers)

    async def search(
        self,
        query: str,
        year: str | int | None = None,
    ) -> str:
        """Search for academic papers and return formatted results."""
        if not query:
            return "Error: 'query' argument is required"

        logger.info("Paper search (semantic scholar) for: %s", query)

        try:
            results = await self._search_semantic_scholar(query, year, self.max_results)
            return self.format_results(results)
        except TimeoutError:
            logger.error("Semantic Scholar paper search timed out for query: %s", query)
            return f"Paper search timed out after {self.timeout}s for query: {query}"
        except Exception as exc:
            logger.error("Semantic Scholar paper search failed: %s", exc)
            return f"Paper search failed: {exc}"
