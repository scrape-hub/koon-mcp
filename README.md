# koon-mcp

MCP server for Claude Code that fetches web content using real browser TLS/HTTP2 fingerprints. Bypasses Cloudflare, Akamai, and other bot detection systems that block standard HTTP clients.

Built on [koon](https://github.com/scrape-hub/koon) — a browser impersonation library using Rust + BoringSSL.

## Why?

Standard `fetch`, `curl`, or built-in web tools get blocked by bot detection on many popular websites (403 Forbidden, CAPTCHAs, empty responses). koon-mcp solves this by making requests that are indistinguishable from a real browser at the TLS and HTTP/2 protocol level.

| Site | curl / standard fetch | koon-mcp |
|---|---|---|
| ticketmaster.com | 403 Forbidden | Full content |
| nike.com | JS challenge / blocked | Full content |
| linkedin.com | Restricted | Full content |

## Features

- **Browser impersonation** — Chrome, Firefox, Safari, Edge fingerprints (175+ profiles)
- **HTML → Markdown** — Clean extraction using Readability + Turndown (no images, scripts, iframes)
- **JSON handling** — Auto-formats JSON responses as fenced code blocks
- **15-minute cache** — Self-cleaning in-memory cache to avoid redundant requests
- **Content truncation** — Large pages capped at 100k characters to stay within context limits
- **Auto HTTPS upgrade** — `http://` URLs are automatically upgraded to `https://`

## Install as Claude Code Plugin

```bash
claude plugin install koon-fetch
```

Or add the marketplace first if not yet available in the official directory:

```bash
claude plugin marketplace add scrape-hub/koon-mcp
claude plugin install koon-fetch@scrape-hub/koon-mcp
```

## Manual Setup

Add to your Claude Code MCP config (`~/.claude/settings.json` or project `.mcp.json`):

```json
{
  "mcpServers": {
    "koon-fetch": {
      "command": "npx",
      "args": ["-y", "koon-mcp"]
    }
  }
}
```

## Tool

### `koon_fetch`

Fetches a URL and returns the content as markdown.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `url` | string | yes | The URL to fetch |
| `prompt` | string | no | Hint for what information to extract |

**Example usage in Claude Code:**

> "Fetch the pricing page from example.com"

Claude will call `koon_fetch` with `url: "https://example.com/pricing"` and return clean markdown content.

## How It Works

1. **koonjs** opens a TLS connection with a real browser fingerprint (JA3, AEAD, ALPN, HTTP/2 frames)
2. The response HTML is parsed with **JSDOM**
3. **Readability** extracts the main article content (falls back to full body)
4. **Turndown** converts HTML to clean markdown
5. Result is cached for 15 minutes

## Requirements

- Node.js 18+
- koon native binaries are bundled with `koonjs` (no extra install needed)

## License

MIT
