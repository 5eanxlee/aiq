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

"""NAT register function for Semantic Scholar paper search."""

from __future__ import annotations

import logging
import os

from pydantic import Field
from pydantic import SecretStr

from nat.builder.builder import Builder
from nat.builder.function_info import FunctionInfo
from nat.cli.register_workflow import register_function
from nat.data_models.function import FunctionBaseConfig

from .search import SemanticScholarSearchTool

logger = logging.getLogger(__name__)

_unauthenticated_mode_warned = False


class SemanticScholarSearchConfig(FunctionBaseConfig, name="semantic_scholar_search"):
    """Configuration for Semantic Scholar-backed paper search."""

    timeout: int = Field(
        default=30,
        description="Timeout in seconds for the search requests",
    )
    max_results: int = Field(
        default=10,
        description="Maximum number of search results to return",
    )
    semantic_scholar_api_key: SecretStr | None = Field(
        default=None,
        description="Optional API key for Semantic Scholar",
    )


@register_function(config_type=SemanticScholarSearchConfig)
async def semantic_scholar_search(tool_config: SemanticScholarSearchConfig, builder: Builder):
    """Register paper search tool using Semantic Scholar."""
    del builder

    if not os.environ.get("SEMANTIC_SCHOLAR_API_KEY") and tool_config.semantic_scholar_api_key:
        os.environ["SEMANTIC_SCHOLAR_API_KEY"] = tool_config.semantic_scholar_api_key.get_secret_value()

    api_key = os.environ.get("SEMANTIC_SCHOLAR_API_KEY")

    if not api_key:
        global _unauthenticated_mode_warned
        if not _unauthenticated_mode_warned:
            logger.warning(
                "SEMANTIC_SCHOLAR_API_KEY not found. Semantic Scholar search will use "
                "unauthenticated access, which may have stricter rate limits."
            )
            _unauthenticated_mode_warned = True

    tool = SemanticScholarSearchTool(
        semantic_scholar_api_key=api_key,
        timeout=tool_config.timeout,
        max_results=tool_config.max_results,
    )

    async def _semantic_scholar_search(
        query: str,
        year: str | int | None = None,
    ) -> str:
        """Searches Semantic Scholar for peer-reviewed academic papers and scientific publications.

        This tool returns papers from Semantic Scholar with abstracts, citation counts,
        venues, and canonical paper URLs for scholarly research queries.

        Args:
            query (str): The search query string.
            year (str | int | None): Optional year or year range such as "2023" or "2020-2023".

        Returns:
            str: Formatted string with search results.
        """

        return await tool.search(query, year)

    yield FunctionInfo.from_fn(
        _semantic_scholar_search,
        description=_semantic_scholar_search.__doc__,
    )
