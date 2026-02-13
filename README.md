# spider-cloud-mcp

MCP server for the [Spider](https://spider.cloud) web crawling and scraping API. Crawl, scrape, search, and extract web data for AI agents, RAG pipelines, and LLMs.

## Setup

### 1. Get your API key

Sign up at [spider.cloud](https://spider.cloud) and get your API key from the [API Keys](https://spider.cloud/api-keys) page.

### 2. Configure your MCP client

#### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "spider": {
      "command": "npx",
      "args": ["-y", "spider-cloud-mcp"],
      "env": {
        "SPIDER_API_KEY": "your-api-key"
      }
    }
  }
}
```

#### Claude Code

```bash
claude mcp add spider -- npx -y spider-cloud-mcp
```

Then set your API key in the environment or `.env` file:

```
SPIDER_API_KEY=your-api-key
```

#### Cursor

Add to your Cursor MCP settings:

```json
{
  "mcpServers": {
    "spider": {
      "command": "npx",
      "args": ["-y", "spider-cloud-mcp"],
      "env": {
        "SPIDER_API_KEY": "your-api-key"
      }
    }
  }
}
```

## Tools

### Core Tools

| Tool | Description |
|------|-------------|
| `spider_crawl` | Crawl a website and extract content from multiple pages |
| `spider_scrape` | Scrape a single page (no crawling) |
| `spider_search` | Search the web with optional page content fetching |
| `spider_links` | Extract all links from a page |
| `spider_screenshot` | Capture page screenshots |
| `spider_unblocker` | Access bot-protected content with anti-bot bypass |
| `spider_transform` | Transform HTML to markdown/text/other formats |
| `spider_get_credits` | Check your credit balance |

### AI Tools (Subscription Required)

These tools require an active [AI subscription plan](https://spider.cloud/ai/pricing).

| Tool | Description |
|------|-------------|
| `spider_ai_crawl` | AI-guided crawling with natural language prompts |
| `spider_ai_scrape` | Extract structured data using plain English |
| `spider_ai_search` | AI-enhanced semantic web search |
| `spider_ai_browser` | Automate browser interactions with natural language |
| `spider_ai_links` | Intelligent link extraction and filtering |

## Examples

### Crawl a website to markdown

```
Use spider_crawl to crawl https://example.com with limit 10 and return_format "markdown"
```

### Search the web

```
Use spider_search to search for "latest AI research papers" with fetch_page_content true and num 5
```

### AI-powered extraction

```
Use spider_ai_scrape on https://news.ycombinator.com with prompt "Extract all article titles, URLs, points, and comment counts as structured JSON"
```

### Check credits

```
Use spider_get_credits to check my balance
```

## API Reference

Full API documentation: [spider.cloud/docs/api](https://spider.cloud/docs/api)

## License

MIT
