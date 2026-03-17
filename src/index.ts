#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { fetchUrl } from "./fetcher.js";

const server = new McpServer({
  name: "koon-fetch",
  version: "0.6.0",
});

server.registerTool(
  "koon_fetch",
  {
    title: "Koon Web Fetch",
    description:
      "Fetches content from a URL using browser-impersonating HTTP client (bypasses Cloudflare, Akamai, and other bot detection). " +
      "Converts HTML to clean markdown. Handles JSON, plain text, and binary content. " +
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
    },
  },
  async ({ url, prompt }) => {
    try {
      const result = await fetchUrl(url);

      let responseText = "";
      responseText += `**Source:** ${result.url}\n`;
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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("koon-mcp server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
