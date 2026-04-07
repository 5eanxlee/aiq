# Semantic Scholar Search

A NeMo Agent Toolkit function that searches for academic papers using the Semantic Scholar Academic Graph API.

## Prerequisites

Semantic Scholar search works without an API key, but you can optionally add one for authenticated access:

```bash
SEMANTIC_SCHOLAR_API_KEY="your-semantic-scholar-api-key"
```

You can place that in `deploy/.env` or provide it directly in workflow config.

## Installation

Install the package using `uv` from the project root:

```bash
uv pip install -e sources/semantic_scholar_search
```

After installation, verify the plugin is registered:

```bash
nat info components -t function | grep semantic_scholar_search
```

## Configuration

To preserve existing deep-research prompt behavior, keep the function name `paper_search_tool`
and swap only the backend type:

```yaml
functions:
  paper_search_tool:
    _type: semantic_scholar_search
    max_results: 5
    timeout: 30
    semantic_scholar_api_key: ${SEMANTIC_SCHOLAR_API_KEY}

  deep_research_agent:
    _type: deep_research_agent
    tools:
      - paper_search_tool
      - advanced_web_search_tool
      - knowledge_search
```

### Configuration Options

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `max_results` | integer | 10 | Maximum number of papers to return |
| `timeout` | integer | 30 | Timeout in seconds for requests |
| `semantic_scholar_api_key` | string | None | Optional Semantic Scholar API key |

## Usage

The function accepts:

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `query` | string | Yes | Search query for academic papers |
| `year` | string or integer | No | Year or year range such as `2024` or `2022-2024` |

## Notes

- The tool uses Semantic Scholar's paper search endpoint.
- If an open-access PDF link is available, it is included alongside the Semantic Scholar paper page.
- Remaining quota is not exposed by the Semantic Scholar API, so the dashboard can verify connectivity but not credits.
