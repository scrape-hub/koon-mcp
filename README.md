# koon-mcp

An MCP server for Claude Code that fetches web pages with real browser fingerprints. Sites behind Cloudflare, Akamai and other bot detection that block ordinary HTTP clients see the same TLS, HTTP/2 and HTTP/3 handshake from it as from a real browser.

It is built on [koon](https://github.com/scrape-hub/koon), a browser-impersonating HTTP client written in Rust on BoringSSL.

## Why

`fetch`, `curl` and built-in web tools get blocked on many popular sites: a 403, a CAPTCHA page or an empty response. koon-mcp sends requests that look like a real browser's down to the TLS and HTTP/2 level.

Home pages fetched with Node.js `fetch` and with koon-mcp 1.0.0 on 2026-09-28.
Which sites block what changes over time.

| Site | Category | Node.js `fetch` | koon-mcp |
|---|---|---|---|
| medium.com | Articles / Blog | 403 | 200 |
| bloomberg.com | Financial news | 403 | 200 |
| glassdoor.com | Jobs / Salaries | 403 | 200 |
| stockx.com | E-Commerce | 403 | 200 |
| tripadvisor.com | Travel / Reviews | 403 | 200 |

## Features

- **Browser impersonation**: requests go out as the latest Chrome that koon knows, with its TLS, HTTP/2 and HTTP/3 fingerprint.
- **HTML to Markdown**: Readability extracts the main content and Turndown converts it, without images, scripts or iframes.
- **JSON**: JSON responses come back as fenced code blocks.
- **15-minute cache**: repeated fetches of the same URL are answered from memory.
- **Truncation**: pages are capped at 100,000 characters to fit the context.
- **Default scheme**: a URL without a scheme is fetched over `https://`.

## Install as a Claude Code plugin

```bash
claude plugin marketplace add scrape-hub/koon-mcp
claude plugin install koon-fetch@koon-marketplace
```

## Manual setup

To use the MCP server without the plugin:

```bash
claude mcp add koon-fetch -- npx -y koon-mcp
```

Or in a project's `.mcp.json`:

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

Fetches a URL and returns the content as Markdown.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `url` | string | yes | The URL to fetch |
| `prompt` | string | no | Hint for what information to extract |

**Example in Claude Code:**

> "Fetch the pricing page from example.com"

Claude calls `koon_fetch` with `url: "https://example.com/pricing"` and gets the page back as Markdown.

## How it works

1. koonjs opens the connection with the browser's TLS ClientHello and HTTP/2 or HTTP/3 settings.
2. JSDOM parses the HTML.
3. Readability extracts the main content, or the whole body if it finds none.
4. Turndown converts the HTML to Markdown.
5. The result is cached for 15 minutes.

## Requirements

- Node.js 18.17 or newer
- The koon native binaries come with `koonjs`, so there is nothing else to install.

## License

MIT
