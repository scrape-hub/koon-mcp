#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchUrl } from "./fetcher.js";

const server = new McpServer({
  name: "koon-fetch",
  version: "1.1.0",
});

server.registerTool(
  "koon_fetch",
  {
    title: "Koon Web Fetch",
    description:
      "Fetches content from a URL using browser-impersonating HTTP client (bypasses Cloudflare, Akamai, and other bot detection). " +
      "Converts HTML to clean markdown. Handles JSON, plain text, and binary content. " +
      "When a site turns away the request as Chrome, tries Firefox and Safari; if all three are turned away, names the bot protection that answered. " +
      "Stack Overflow and other Stack Exchange question links return the question with its top answers through the official API. " +
      "PDFs: returns their text marked by page number; a long PDF from page 1 on up to about 16,000 characters plus its " +
      "outline, further pages with `pages` (e.g. \"5-8\", up to 20 per call, from a working copy kept for the session). " +
      "A paper that names a DOI or arXiv id also gets title, authors, year and DOI. " +
      "`save: true` keeps the PDF in <project>/pdf/ (papers named \"Author et al. - Year - Title.pdf\"); " +
      "save only when the user wants to keep the file. " +
      "Includes 15-minute caching. Use this instead of WebFetch for all web requests.",
    inputSchema: {
      url: z.string().describe("The URL to fetch. HTTP URLs are auto-upgraded to HTTPS."),
      prompt: z
        .string()
        .optional()
        .describe(
          "Optional prompt describing what information to look for. " +
            "The content is returned as-is for Claude to process."
        ),
      pages: z
        .string()
        .optional()
        .describe('PDF only: pages to return as text, e.g. "5", "3-7" or "1,4,9-11" (up to 20 per call). A PDF fetched earlier in the session is read from its working copy.'),
      save: z
        .boolean()
        .optional()
        .describe("PDF only: keep the PDF permanently, in <project>/pdf/ unless save_dir is given. Also works for a PDF fetched earlier in the session."),
      save_dir: z
        .string()
        .optional()
        .describe("PDF only: folder for save, absolute or relative to the project folder."),
    },
  },
  async ({ url, prompt, pages, save, save_dir }) => {
    try {
      const result = await fetchUrl(url, { pages, save, saveDir: () => resolveSaveDir(save_dir) });

      let responseText = "";
      responseText += `**Source:** ${result.url}\n`;
      if (result.via) {
        responseText += `**Fetched via:** ${result.via}\n`;
      }
      if (result.cached) {
        responseText += `**Cached:** yes (15-min TTL)\n`;
      }
      if (result.truncated) {
        responseText += `**Note:** Content was truncated to 100,000 characters.\n`;
      }
      responseText += "\n---\n\n";
      responseText += result.content;

      if (prompt) {
        responseText += `\n\n---\n**User's prompt for this content:** ${prompt}`;
      }

      return {
        content: [{ type: "text" as const, text: responseText }],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to fetch ${url}: ${message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

const ROOTS_TIMEOUT_MS = 5_000;

/** The project folder: set by Claude Code, else the client's first root, else where the server was started. */
async function projectDir(): Promise<string> {
  if (process.env.CLAUDE_PROJECT_DIR) return process.env.CLAUDE_PROJECT_DIR;
  if (server.server.getClientCapabilities()?.roots) {
    try {
      // the SDK would otherwise wait 60 s for a client that announced roots but never answers
      const { roots } = await server.server.listRoots(undefined, { timeout: ROOTS_TIMEOUT_MS });
      const root = roots.find((r) => r.uri.startsWith("file://"));
      if (root) return fileURLToPath(root.uri);
    } catch {
      // client announced roots but did not answer
    }
  }
  return process.cwd();
}

/** save_dir, else KOON_MCP_PDF_DIR, else <project>/pdf. "~" is the home folder, other relative paths the project's. */
async function resolveSaveDir(saveDir?: string): Promise<string> {
  let dir = saveDir || process.env.KOON_MCP_PDF_DIR;
  if (dir && /^~(?=$|[\\/])/.test(dir)) dir = join(homedir(), dir.slice(1));
  if (dir) return isAbsolute(dir) ? dir : resolve(await projectDir(), dir);
  return join(await projectDir(), "pdf");
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("koon-mcp server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
