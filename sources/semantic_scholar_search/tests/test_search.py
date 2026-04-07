# SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Tests for SemanticScholarSearchTool."""

from unittest.mock import AsyncMock
from unittest.mock import patch

import pytest

from semantic_scholar_search.search import SemanticScholarSearchTool


class TestSemanticScholarSearchToolInit:
    """Tests for SemanticScholarSearchTool initialization."""

    def test_init_with_defaults(self):
        tool = SemanticScholarSearchTool()

        assert tool.semantic_scholar_api_key is None
        assert tool.timeout == 30
        assert tool.max_results == 10

    def test_init_with_all_params(self):
        tool = SemanticScholarSearchTool(
            semantic_scholar_api_key="test-key",
            timeout=45,
            max_results=7,
        )

        assert tool.semantic_scholar_api_key == "test-key"
        assert tool.timeout == 45
        assert tool.max_results == 7


class TestFormatResults:
    """Tests for result formatting."""

    def test_format_results_empty(self):
        assert SemanticScholarSearchTool.format_results([]) == "No papers found via Semantic Scholar."

    def test_format_results_includes_urls(self, sample_semantic_scholar_results):
        result = SemanticScholarSearchTool.format_results([sample_semantic_scholar_results[0]])

        assert "1. **Attention Is All You Need** (2017)" in result
        assert "**Venue**: NeurIPS" in result
        assert "**Authors**: Ashish Vaswani, Noam Shazeer" in result
        assert "**Open Access PDF**: https://arxiv.org/abs/1706.03762" in result
        assert "**Semantic Scholar**: https://www.semanticscholar.org/paper/paper-1" in result

    def test_format_results_extracts_pdf_from_disclaimer(self, sample_semantic_scholar_results):
        result = SemanticScholarSearchTool.format_results([sample_semantic_scholar_results[1]])

        assert "**Open Access PDF**: https://arxiv.org/abs/1810.04805" in result
        assert "**Semantic Scholar**: https://www.semanticscholar.org/paper/paper-2" in result


class TestSearch:
    """Tests for public search behavior."""

    @pytest.mark.asyncio
    async def test_search_empty_query(self, semantic_scholar_tool):
        result = await semantic_scholar_tool.search("")

        assert result == "Error: 'query' argument is required"

    @pytest.mark.asyncio
    async def test_search_success(self, semantic_scholar_tool, sample_semantic_scholar_results):
        with patch.object(
            semantic_scholar_tool,
            "_search_semantic_scholar",
            new_callable=AsyncMock,
            return_value=sample_semantic_scholar_results,
        ):
            result = await semantic_scholar_tool.search("transformers")

        assert "Attention Is All You Need" in result
        assert "BERT" in result

    @pytest.mark.asyncio
    async def test_search_with_integer_year(self, semantic_scholar_tool, sample_semantic_scholar_results):
        mock_search = AsyncMock(return_value=sample_semantic_scholar_results)
        with patch.object(semantic_scholar_tool, "_search_semantic_scholar", mock_search):
            await semantic_scholar_tool.search("transformers", year=2023)

        mock_search.assert_called_once_with("transformers", 2023, 10)

    @pytest.mark.asyncio
    async def test_search_timeout_error(self, semantic_scholar_tool):
        with patch.object(
            semantic_scholar_tool,
            "_search_semantic_scholar",
            new_callable=AsyncMock,
            side_effect=TimeoutError("timed out"),
        ):
            result = await semantic_scholar_tool.search("test query")

        assert "Paper search timed out" in result
        assert "30s" in result

    @pytest.mark.asyncio
    async def test_search_general_exception(self, semantic_scholar_tool):
        with patch.object(
            semantic_scholar_tool,
            "_search_semantic_scholar",
            new_callable=AsyncMock,
            side_effect=Exception("API Error"),
        ):
            result = await semantic_scholar_tool.search("test query")

        assert "Paper search failed" in result
        assert "API Error" in result
