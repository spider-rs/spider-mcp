#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_BASE = "https://api.spider.cloud";

function getApiKey(): string {
  const key = process.env.SPIDER_API_KEY;
  if (!key) {
    throw new Error(
      "SPIDER_API_KEY environment variable is required. Get your key at https://spider.cloud/api-keys"
    );
  }
  return key;
}

/**
 * Parse a JSONL (newline-delimited JSON) stream into an array of objects.
 * Handles:
 * - Large JSON objects spanning multiple chunks
 * - UTF-8 multi-byte characters split across chunk boundaries
 * - \r\n and \n line endings
 * - Empty lines and whitespace-only lines
 * - Malformed lines (skipped with warning)
 */
async function parseJsonlStream(
  body: ReadableStream<Uint8Array>
): Promise<unknown[]> {
  const results: unknown[] = [];
  const decoder = new TextDecoder("utf-8");
  const reader = body.getReader();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        // Flush any remaining buffered data
        const remaining = buffer.trim();
        if (remaining.length > 0) {
          try {
            results.push(JSON.parse(remaining));
          } catch {
            // Final chunk wasn't valid JSON — may be a partial write
          }
        }
        break;
      }

      // stream: true tells TextDecoder to handle multi-byte chars split across chunks
      buffer += decoder.decode(value, { stream: true });

      // Extract complete lines (delimited by \n)
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIdx).replace(/\r$/, "");
        buffer = buffer.slice(newlineIdx + 1);

        if (line.length === 0) continue;

        try {
          results.push(JSON.parse(line));
        } catch {
          // Skip malformed JSONL lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return results;
}

/**
 * Make a request to the Spider API.
 * - Streaming endpoints use Content-Type: application/jsonl for incremental parsing
 * - Non-streaming endpoints use Content-Type: application/json
 */
async function apiRequest(
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
  options?: { stream?: boolean }
): Promise<unknown> {
  const useJsonl = options?.stream ?? false;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${getApiKey()}`,
    "Content-Type": useJsonl ? "application/jsonl" : "application/json",
  };

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spider API error ${res.status}: ${text}`);
  }

  // JSONL streaming: parse line by line from the stream
  if (useJsonl && res.body) {
    return parseJsonlStream(res.body);
  }

  // JSON fallback: read full body and parse
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function formatResult(data: unknown): string {
  if (typeof data === "string") return data;
  return JSON.stringify(data, null, 2);
}

// Shared parameter schemas
const crawlParams = {
  url: z.string().describe("The URL to crawl. Can be comma-separated for multiple URLs."),
  limit: z.number().optional().describe("Maximum pages to crawl per website. 0 for all pages. Default: 0"),
  depth: z.number().optional().describe("Maximum crawl depth. Default: 25. 0 for no limit."),
  request: z.enum(["http", "chrome", "smart"]).optional().describe("Request type. Default: smart"),
  return_format: z.union([
    z.enum(["markdown", "commonmark", "raw", "text", "xml", "bytes", "empty"]),
    z.array(z.string())
  ]).optional().describe("Output format. Default: raw"),
  readability: z.boolean().optional().describe("Use readability algorithm for content preprocessing"),
  return_page_links: z.boolean().optional().describe("Return links found on each page"),
  return_json_data: z.boolean().optional().describe("Return JSON data from SSR scripts"),
  return_headers: z.boolean().optional().describe("Return HTTP response headers"),
  return_cookies: z.boolean().optional().describe("Return HTTP response cookies"),
  metadata: z.boolean().optional().describe("Collect page metadata (title, description, keywords)"),
  css_extraction_map: z.record(z.unknown()).optional().describe("CSS/XPath selectors to scrape specific content per path"),
  root_selector: z.string().optional().describe("Root CSS query selector for content extraction"),
  exclude_selector: z.string().optional().describe("CSS selector for content to ignore"),
  filter_output_images: z.boolean().optional().describe("Filter images from output"),
  filter_output_svg: z.boolean().optional().describe("Filter SVG tags from output"),
  filter_output_main_only: z.boolean().optional().describe("Filter nav, aside, footer from output"),
  filter_svg: z.boolean().optional().describe("Filter SVG elements from markup"),
  filter_images: z.boolean().optional().describe("Filter image elements from markup"),
  filter_main_only: z.boolean().optional().describe("Filter to main content only. Default: enabled"),
  clean_html: z.boolean().optional().describe("Clean HTML of unwanted attributes"),
  proxy_enabled: z.boolean().optional().describe("Enable premium proxies. Multiplies cost by 1.5x"),
  proxy: z.enum(["residential", "mobile", "isp", "datacenter"]).optional().describe("Proxy pool type"),
  remote_proxy: z.string().optional().describe("External proxy connection URL"),
  country_code: z.string().optional().describe("ISO country code for proxy (e.g. 'gb')"),
  fingerprint: z.boolean().optional().describe("Advanced fingerprint detection for Chrome. Default: true"),
  cookies: z.string().optional().describe("HTTP cookies for SSR authentication"),
  external_domains: z.array(z.string()).optional().describe("External domains to include. Use ['*'] for all"),
  subdomains: z.boolean().optional().describe("Allow subdomains"),
  tld: z.boolean().optional().describe("Allow TLDs"),
  blacklist: z.array(z.string()).optional().describe("Paths to exclude (supports regex)"),
  whitelist: z.array(z.string()).optional().describe("Paths to include (supports regex)"),
  redirect_policy: z.enum(["Loose", "Strict", "None"]).optional().describe("Redirect policy. Default: Loose"),
  delay: z.number().optional().describe("Crawl delay in ms (max 60000). Disables concurrency"),
  concurrency_limit: z.number().optional().describe("Concurrency limit for slower websites"),
  respect_robots: z.boolean().optional().describe("Respect robots.txt. Default: true"),
  cache: z.union([z.boolean(), z.record(z.unknown())]).optional().describe("HTTP caching. Object: {maxAge, allowStale, period}"),
  storageless: z.boolean().optional().describe("Prevent data storage. Default: true"),
  session: z.boolean().optional().describe("Persist HTTP headers and cookies. Default: true"),
  user_agent: z.string().optional().describe("Custom HTTP user agent"),
  full_resources: z.boolean().optional().describe("Download all website resources including assets"),
  sitemap: z.boolean().optional().describe("Include links from sitemaps"),
  sitemaps: z.array(z.string()).optional().describe("Specific sitemap URLs to use"),
  request_timeout: z.number().optional().describe("HTTP request timeout in ms"),
  request_max_retries: z.number().optional().describe("Maximum request retries"),
  request_redirect_limit: z.number().optional().describe("Maximum redirects to follow"),
  budget: z.record(z.number()).optional().describe("Crawl budget by path (e.g. {'*':100})"),
  chunking_alg: z.record(z.unknown()).optional().describe("Segment content: bysentence, bylines, bycharacterlength, bywords"),
  automation: z.record(z.unknown()).optional().describe("Web automation actions (Click, Fill, Wait, Scroll, etc.)"),
  preserve_host: z.boolean().optional().describe("Preserve HOST header"),
  event_tracker: z.record(z.unknown()).optional().describe("Track requests, responses, automation"),
  disable_intercept: z.boolean().optional().describe("Disable request interception"),
  block_ads: z.boolean().optional().describe("Block advertisements. Default: true"),
  block_analytics: z.boolean().optional().describe("Block analytics. Default: true"),
  block_stylesheets: z.boolean().optional().describe("Block stylesheets. Default: true"),
  run_in_background: z.boolean().optional().describe("Run in background. Requires storageless=false or webhooks"),
  viewport: z.object({
    width: z.number().optional(),
    height: z.number().optional(),
    device_scale_factor: z.number().optional(),
    emulating_mobile: z.boolean().optional(),
    is_landscape: z.boolean().optional(),
    has_touch: z.boolean().optional(),
  }).optional().describe("Device viewport settings"),
  locale: z.string().optional().describe("Locale for content (e.g. 'en-US')"),
  timezone: z.string().optional().describe("Timezone for content"),
  timeout: z.number().optional().describe("Overall request timeout"),
  webhooks: z.record(z.unknown()).optional().describe("Webhook config for events (on_find, on_credits_depleted, etc.)"),
  cron: z.enum(["daily", "weekly", "monthly"]).optional().describe("Schedule crawl"),
};

const screenshotExtraParams = {
  screenshot: z.boolean().optional().describe("Enable screenshot capture"),
  binary: z.boolean().optional().describe("Return image as binary instead of base64"),
  full_page: z.boolean().optional().describe("Screenshot full page. Default: true"),
  block_images: z.boolean().optional().describe("Block image loading"),
  omit_background: z.boolean().optional().describe("Omit background"),
  cdp_params: z.record(z.unknown()).optional().describe("Chrome DevTools Protocol settings"),
};

// Build scrape params (crawl minus limit/depth/delay)
const { limit: _l, depth: _d, delay: _dl, ...scrapeBase } = crawlParams;
const scrapeParams = { ...scrapeBase, ...screenshotExtraParams };

const server = new McpServer({
  name: "spider-cloud-mcp",
  version: "1.2.1",
});

// === Core Tools ===

server.tool(
  "spider_crawl",
  "Crawl a website and extract content from multiple pages. Returns page content in the specified format (markdown, HTML, text, etc.). Powered by Spider - the fastest web crawler at 100K+ pages/sec.",
  crawlParams,
  async (params) => {
    const data = await apiRequest("POST", "/crawl", params as Record<string, unknown>, { stream: true });
    return { content: [{ type: "text" as const, text: formatResult(data) }] };
  }
);

server.tool(
  "spider_scrape",
  "Scrape a single page and extract its content. No crawling — just fetches and processes one URL. Supports all output formats and screenshot capture.",
  scrapeParams,
  async (params) => {
    const data = await apiRequest("POST", "/scrape", params as Record<string, unknown>, { stream: true });
    return { content: [{ type: "text" as const, text: formatResult(data) }] };
  }
);

server.tool(
  "spider_search",
  "Search the web and optionally crawl results. Returns search results with optional full page content.",
  {
    search: z.string().describe("The search query to perform"),
    search_limit: z.number().optional().describe("Max URLs to fetch from results. 0 for all"),
    num: z.number().optional().describe("Maximum number of results to return"),
    fetch_page_content: z.boolean().optional().describe("Fetch full website content. Default: false"),
    country: z.string().optional().describe("Two-letter country code (e.g. 'us')"),
    location: z.string().optional().describe("Location origin (e.g. 'United Kingdom')"),
    language: z.string().optional().describe("Two-letter language code (e.g. 'en')"),
    tbs: z.string().optional().describe("Time range: qdr:h (hour), qdr:d (24h), qdr:w (week), qdr:m (month), qdr:y (year)"),
    page: z.number().optional().describe("Page number for results"),
    quick_search: z.boolean().optional().describe("Prioritize speed over quantity"),
    auto_pagination: z.boolean().optional().describe("Auto-paginate to exact desired result count"),
    url: z.string().optional().describe("Optional URL context"),
    limit: z.number().optional().describe("Page crawl limit for fetched results"),
    return_format: z.union([
      z.enum(["markdown", "commonmark", "raw", "text", "xml", "bytes", "empty"]),
      z.array(z.string())
    ]).optional().describe("Output format for fetched content"),
    request: z.enum(["http", "chrome", "smart"]).optional().describe("Request type"),
    proxy_enabled: z.boolean().optional().describe("Enable premium proxies"),
    cookies: z.string().optional().describe("HTTP cookies"),
  },
  async (params) => {
    const data = await apiRequest("POST", "/search", params as Record<string, unknown>, { stream: true });
    return { content: [{ type: "text" as const, text: formatResult(data) }] };
  }
);

server.tool(
  "spider_links",
  "Extract all links from a page without fetching content. Fast way to discover URLs on a site.",
  {
    url: z.string().describe("The URL to extract links from"),
    limit: z.number().optional().describe("Maximum links to return"),
    return_format: z.union([
      z.enum(["markdown", "commonmark", "raw", "text", "xml", "bytes", "empty"]),
      z.array(z.string())
    ]).optional().describe("Output format"),
    request: z.enum(["http", "chrome", "smart"]).optional().describe("Request type"),
  },
  async (params) => {
    const data = await apiRequest("POST", "/links", params as Record<string, unknown>, { stream: true });
    return { content: [{ type: "text" as const, text: formatResult(data) }] };
  }
);

server.tool(
  "spider_screenshot",
  "Capture screenshots of web pages. Returns base64-encoded images or binary data.",
  {
    url: z.string().describe("The URL to screenshot"),
    ...screenshotExtraParams,
    viewport: crawlParams.viewport,
    proxy_enabled: z.boolean().optional().describe("Enable premium proxies"),
    country_code: z.string().optional().describe("ISO country code for proxy"),
    fingerprint: z.boolean().optional().describe("Advanced fingerprint detection"),
    cookies: z.string().optional().describe("HTTP cookies"),
    automation: z.record(z.unknown()).optional().describe("Web automation actions before screenshot"),
    block_ads: z.boolean().optional().describe("Block advertisements"),
    block_analytics: z.boolean().optional().describe("Block analytics"),
    block_stylesheets: z.boolean().optional().describe("Block stylesheets"),
    locale: z.string().optional().describe("Locale"),
    timezone: z.string().optional().describe("Timezone"),
    timeout: z.number().optional().describe("Request timeout"),
  },
  async (params) => {
    const data = await apiRequest("POST", "/screenshot", params as Record<string, unknown>, { stream: true });
    return { content: [{ type: "text" as const, text: formatResult(data) }] };
  }
);

server.tool(
  "spider_unblocker",
  "Access blocked or protected content with advanced anti-bot bypass. Uses enhanced fingerprinting and proxy rotation. Adds 10-40 extra credits per successful unblock.",
  scrapeParams,
  async (params) => {
    const data = await apiRequest("POST", "/unblocker", params as Record<string, unknown>, { stream: true });
    return { content: [{ type: "text" as const, text: formatResult(data) }] };
  }
);

server.tool(
  "spider_transform",
  "Transform HTML content to markdown, text, or other formats. No network requests — processes HTML you provide directly.",
  {
    data: z.array(z.object({
      html: z.string().describe("HTML content to transform"),
      url: z.string().optional().describe("Source URL (optional, used for readability)"),
    })).describe("List of HTML data to transform"),
    return_format: z.union([
      z.enum(["markdown", "commonmark", "raw", "text", "xml", "bytes", "empty"]),
      z.array(z.string())
    ]).optional().describe("Output format"),
    readability: z.boolean().optional().describe("Use readability preprocessing"),
    clean_full: z.boolean().optional().describe("Clean HTML fully"),
    clean: z.boolean().optional().describe("Clean for AI (remove footers, navigation)"),
  },
  async (params) => {
    const data = await apiRequest("POST", "/transform", params as Record<string, unknown>, { stream: true });
    return { content: [{ type: "text" as const, text: formatResult(data) }] };
  }
);

server.tool(
  "spider_get_credits",
  "Check your available Spider API credit balance.",
  {},
  async () => {
    const data = await apiRequest("GET", "/data/credits");
    return { content: [{ type: "text" as const, text: formatResult(data) }] };
  }
);


// === AI Tools (Subscription Required) ===

const AI_SUB_NOTE = "REQUIRES an active AI subscription plan (https://spider.cloud/ai/pricing).";

server.tool(
  "spider_ai_crawl",
  `AI-guided crawling using natural language prompts. Describe what content to find and Spider's AI will guide the crawl. ${AI_SUB_NOTE}`,
  {
    url: z.string().describe("The URL to crawl"),
    prompt: z.string().describe("Natural language prompt to guide the crawl (e.g. 'Find all product pages and extract pricing')"),
    limit: z.number().optional().describe("Maximum pages to crawl"),
    return_format: z.union([
      z.enum(["markdown", "commonmark", "raw", "text", "xml", "bytes", "empty"]),
      z.array(z.string())
    ]).optional().describe("Output format"),
    request: z.enum(["http", "chrome", "smart"]).optional().describe("Request type"),
    proxy_enabled: z.boolean().optional().describe("Enable premium proxies"),
    cookies: z.string().optional().describe("HTTP cookies"),
  },
  async (params) => {
    const data = await apiRequest("POST", "/ai/crawl", params as Record<string, unknown>, { stream: true });
    return { content: [{ type: "text" as const, text: formatResult(data) }] };
  }
);

server.tool(
  "spider_ai_scrape",
  `AI-powered structured data extraction using plain English. Describe what data you want and get structured JSON back — no CSS selectors needed. ${AI_SUB_NOTE}`,
  {
    url: z.string().describe("The URL to scrape"),
    prompt: z.string().describe("Natural language extraction prompt (e.g. 'Extract article title, author, and publish date')"),
    return_format: z.union([
      z.enum(["markdown", "commonmark", "raw", "text", "xml", "bytes", "empty"]),
      z.array(z.string())
    ]).optional().describe("Output format"),
    request: z.enum(["http", "chrome", "smart"]).optional().describe("Request type"),
    proxy_enabled: z.boolean().optional().describe("Enable premium proxies"),
    cookies: z.string().optional().describe("HTTP cookies"),
  },
  async (params) => {
    const data = await apiRequest("POST", "/ai/scrape", params as Record<string, unknown>, { stream: true });
    return { content: [{ type: "text" as const, text: formatResult(data) }] };
  }
);

server.tool(
  "spider_ai_search",
  `AI-enhanced semantic web search. Uses intent understanding and relevance ranking to find the most relevant results. ${AI_SUB_NOTE}`,
  {
    search: z.string().describe("The search query"),
    prompt: z.string().optional().describe("Additional AI guidance for search results"),
    num: z.number().optional().describe("Maximum results"),
    fetch_page_content: z.boolean().optional().describe("Fetch full page content"),
    country: z.string().optional().describe("Two-letter country code"),
    language: z.string().optional().describe("Two-letter language code"),
    tbs: z.string().optional().describe("Time range filter"),
    return_format: z.union([
      z.enum(["markdown", "commonmark", "raw", "text", "xml", "bytes", "empty"]),
      z.array(z.string())
    ]).optional().describe("Output format"),
  },
  async (params) => {
    const data = await apiRequest("POST", "/ai/search", params as Record<string, unknown>, { stream: true });
    return { content: [{ type: "text" as const, text: formatResult(data) }] };
  }
);

server.tool(
  "spider_ai_browser",
  `AI-powered browser automation using natural language. Describe actions like 'click login, fill email, submit form' and Spider automates the browser. ${AI_SUB_NOTE}`,
  {
    url: z.string().describe("The URL to automate"),
    prompt: z.string().describe("Natural language automation instructions (e.g. 'Click the login button, fill in email field, submit')"),
    return_format: z.union([
      z.enum(["markdown", "commonmark", "raw", "text", "xml", "bytes", "empty"]),
      z.array(z.string())
    ]).optional().describe("Output format"),
    proxy_enabled: z.boolean().optional().describe("Enable premium proxies"),
    cookies: z.string().optional().describe("HTTP cookies"),
  },
  async (params) => {
    const data = await apiRequest("POST", "/ai/browser", params as Record<string, unknown>, { stream: true });
    return { content: [{ type: "text" as const, text: formatResult(data) }] };
  }
);

server.tool(
  "spider_ai_links",
  `AI-powered intelligent link extraction and filtering. Describe what links you want and Spider uses AI to find and categorize them. ${AI_SUB_NOTE}`,
  {
    url: z.string().describe("The URL to extract links from"),
    prompt: z.string().describe("Natural language link filter (e.g. 'Find all product pages and documentation links')"),
    limit: z.number().optional().describe("Maximum links"),
    return_format: z.union([
      z.enum(["markdown", "commonmark", "raw", "text", "xml", "bytes", "empty"]),
      z.array(z.string())
    ]).optional().describe("Output format"),
    request: z.enum(["http", "chrome", "smart"]).optional().describe("Request type"),
  },
  async (params) => {
    const data = await apiRequest("POST", "/ai/links", params as Record<string, unknown>, { stream: true });
    return { content: [{ type: "text" as const, text: formatResult(data) }] };
  }
);

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
