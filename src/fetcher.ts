import koonjs from "koonjs";
const { Koon } = koonjs;
import { htmlToMarkdown } from "./html-to-markdown.js";
import { cacheGet, cacheSet } from "./cache.js";

const MAX_CONTENT_LENGTH = 100_000;

let client: InstanceType<typeof Koon> | null = null;

function getClient(): InstanceType<typeof Koon> {
  if (!client) {
    client = new Koon({
      browser: "chrome145",
      timeout: 30000,
      followRedirects: true,
      maxRedirects: 10,
    });
  }
  return client;
}

export interface FetchResult {
  content: string;
  url: string;
  status: number;
  contentType: string;
  cached: boolean;
  truncated: boolean;
}

export async function fetchUrl(url: string): Promise<FetchResult> {
  // Normalize URL
  let normalizedUrl = url.trim();
  if (!/^https?:\/\//i.test(normalizedUrl)) {
    normalizedUrl = "https://" + normalizedUrl;
  }

  // Check cache
  const cached = cacheGet(normalizedUrl);
  if (cached !== null) {
    return {
      content: cached,
      url: normalizedUrl,
      status: 200,
      contentType: "text/html",
      cached: true,
      truncated: false,
    };
  }

  const koon = getClient();
  const resp = await koon.get(normalizedUrl);

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} fetching ${resp.url}`);
  }

  const contentType = (resp.header("content-type") || "").toLowerCase();
  const finalUrl = resp.url;
  let content: string;

  if (contentType.includes("application/json")) {
    try {
      const parsed = resp.json();
      content = "```json\n" + JSON.stringify(parsed, null, 2) + "\n```";
    } catch {
      content = resp.text();
    }
  } else if (
    contentType.includes("text/html") ||
    contentType.includes("application/xhtml")
  ) {
    const rawHtml = resp.text();
    content = htmlToMarkdown(rawHtml, finalUrl);
  } else if (contentType.includes("text/")) {
    content = resp.text();
  } else if (
    contentType.includes("application/xml") ||
    contentType.includes("application/rss")
  ) {
    content = resp.text();
  } else {
    const size = resp.body.length;
    content = `[Binary content: ${contentType || "unknown type"}, ${size} bytes. Cannot display binary content as text.]`;
  }

  // Truncate if too large
  let truncated = false;
  if (content.length > MAX_CONTENT_LENGTH) {
    content =
      content.substring(0, MAX_CONTENT_LENGTH) +
      "\n\n[Content truncated at 100,000 characters]";
    truncated = true;
  }

  // Cache the result
  cacheSet(normalizedUrl, content);

  return {
    content,
    url: finalUrl,
    status: resp.status,
    contentType,
    cached: false,
    truncated,
  };
}
