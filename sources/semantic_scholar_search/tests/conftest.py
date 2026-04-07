# SPDX-FileCopyrightText: Copyright (c) 2025-2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Pytest fixtures for Semantic Scholar search tests."""

import pytest

from semantic_scholar_search.search import SemanticScholarSearchTool


@pytest.fixture
def semantic_scholar_tool():
    """Create a SemanticScholarSearchTool instance for testing."""
    return SemanticScholarSearchTool(
        semantic_scholar_api_key="test-api-key",
        timeout=30,
        max_results=10,
    )


@pytest.fixture
def sample_semantic_scholar_results():
    """Sample Semantic Scholar response payload for testing."""
    return [
        {
            "paperId": "paper-1",
            "title": "Attention Is All You Need",
            "year": 2017,
            "url": "https://www.semanticscholar.org/paper/paper-1",
            "abstract": "The dominant sequence transduction models are based on recurrent neural networks.",
            "citationCount": 50000,
            "influentialCitationCount": 8000,
            "venue": "NeurIPS",
            "authors": [{"name": "Ashish Vaswani"}, {"name": "Noam Shazeer"}],
            "openAccessPdf": {"url": "https://arxiv.org/abs/1706.03762"},
        },
        {
            "paperId": "paper-2",
            "title": "BERT: Pre-training of Deep Bidirectional Transformers",
            "year": 2019,
            "url": "https://www.semanticscholar.org/paper/paper-2",
            "abstract": "We introduce a new language representation model called BERT.",
            "citationCount": 40000,
            "influentialCitationCount": 6000,
            "venue": "NAACL",
            "authors": [{"name": "Jacob Devlin"}],
            "openAccessPdf": {
                "url": "",
                "disclaimer": "Paper available at https://arxiv.org/abs/1810.04805.",
            },
        },
    ]
