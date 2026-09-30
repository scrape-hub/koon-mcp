# koon-mcp

**Web fetching for Claude Code that gets past the 403.** koon-mcp fetches pages the way Chrome does, down to the TLS and HTTP/2 handshake, so sites behind Cloudflare, Akamai and other bot protection hand over the page instead of an error. And PDFs come back as text that Claude can read and cite.

It is built on [koon](https://github.com/scrape-hub/koon), a browser-impersonating HTTP client written in Rust on BoringSSL.

## Why

**WebFetch gets turned away.** Claude Code's built-in WebFetch tells every site it is a bot, and many of the pages you need while coding or researching answer with a 403. koon-mcp gets them:

| Page | WebFetch | koon-mcp |
|---|---|---|
| npm package page | 403 | 200 |
| Medium article | 403 | 200 |
| ACM Digital Library paper | 403 | 200 |
| Science paper | 403 | 200 |
| NEJM article | 403 | 200 |
| Wiley journal article | 403 | 200 |
| Bloomberg | 403 | 200 |
| Morningstar stock page | 403 | 200 |
| Seeking Alpha stock page | 403 | 200 |
| Google Scholar search | error page | results |

**PDFs Claude can actually read.** WebFetch hands its model the raw PDF bytes, and the answer is "compressed binary data". koon-mcp returns the text, page by page.

**The page itself, not a summary.** WebFetch shows Claude a small model's answer about the page. koon-mcp hands over the page as Markdown, so nothing gets lost in between.

## Install as a Claude Code plugin

```bash
claude plugin marketplace add scrape-hub/koon-mcp
claude plugin install koon-fetch@koon-marketplace
```

## Features

- **Browser impersonation**: requests go out as the latest Chrome that koon knows, with its TLS, HTTP/2 and HTTP/3 fingerprint and the language of your system.
- **Browser fallback**: when a site turns away the request as Chrome, it goes out again as Firefox, then Safari.
- **Stack Overflow**: questions on Stack Overflow and the other Stack Exchange sites come with their top answers through the official API.
- **Blocks named**: when all three are turned away, the error names the bot protection that answered, instead of returning its page as content.
- **HTML to Markdown**: Readability extracts the main content and Turndown converts it, without images, scripts or iframes.
- **JSON**: JSON responses come back as fenced code blocks.
- **PDF**: text with page numbers, more pages on request, papers with title, authors and DOI. See [PDFs](#pdfs).
- **15-minute cache**: repeated fetches of the same URL are answered from memory.
- **Truncation**: pages are capped at 100,000 characters to fit the context.
- **Default scheme**: a URL without a scheme is fetched over `https://`.

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
| `pages` | string | no | PDF only: pages to return, e.g. `"5"`, `"3-7"`, `"1,4,9-11"` (up to 20 per call) |
| `save` | boolean | no | PDF only: keep the PDF permanently, in `pdf/` of the project folder |
| `save_dir` | string | no | PDF only: folder for `save`: absolute, relative to the project folder, or starting with `~` |

**Example in Claude Code:**

> "Fetch the pricing page from example.com"

Claude calls `koon_fetch` with `url: "https://example.com/pricing"` and gets the page back as Markdown.

## PDFs

- Text with page numbers, so Claude can cite the page.
- Long PDFs start with the first pages and the table of contents; `pages: "12-15"` reads on.
- Papers with a DOI or arXiv id come with title, authors, year and DOI.
- `save: true` keeps the PDF in `pdf/` of your project as `Vaswani et al. - 2017 - Attention Is All You Need.pdf` (another folder: `save_dir` or `KOON_MCP_PDF_DIR`).

## How it works

1. koonjs opens the connection with the TLS ClientHello and HTTP/2 or HTTP/3 settings of Chrome, or of Firefox and then Safari when the site turns the request away.
2. HTML: JSDOM parses the page, Readability extracts the main content (or the whole body if it finds none) and Turndown converts it to Markdown.
3. PDF: pdf.js, through `unpdf`, extracts the text of each page.
4. Pages are cached for 15 minutes; a PDF stays as a working copy for the session.

## Requirements

- Node.js 18.17 or newer
- The koon native binaries come with `koonjs`, so there is nothing else to install.

## License

MIT
