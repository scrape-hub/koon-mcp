import koonjs from "koonjs";
const { Koon } = koonjs;
import { htmlToMarkdown } from "./html-to-markdown.js";
import { cacheGet, cacheSet } from "./cache.js";
import { isPdf, parsePageSpec, parsePdf } from "./pdf.js";
import { metaByDoi, metaByTitle, metaFromPdf, paperFileName } from "./pdf-meta.js";
import { addEntry, getEntry, savePermanently, type PdfEntry } from "./pdf-store.js";
import { formatOverview, formatPages } from "./pdf-format.js";

const MAX_CONTENT_LENGTH = 100_000;

let client: InstanceType<typeof Koon> | null = null;

function getClient(): InstanceType<typeof Koon> {
  if (!client) {
    client = new Koon({
      // The latest Chrome koon knows: a pinned version falls behind the real browser.
      browser: "chrome",
      timeout: 30,
      followRedirects: true,
      maxRedirects: 10,
    });
  }
  return client;
}

export interface FetchOptions {
  /** PDF pages to return, e.g. "5-8" or "1,4,9-11". */
  pages?: string;
  /** Keep the PDF permanently. */
  save?: boolean;
  /** Folder for save; resolved by the caller when omitted. */
  saveDir?: () => Promise<string>;
}

export interface FetchResult {
  content: string;
  url: string;
  status: number;
  contentType: string;
  cached: boolean;
  truncated: boolean;
}

function truncate(content: string): { content: string; truncated: boolean } {
  if (content.length <= MAX_CONTENT_LENGTH) return { content, truncated: false };
  return {
    content: content.substring(0, MAX_CONTENT_LENGTH) + "\n\n[Content truncated at 100,000 characters]",
    truncated: true,
  };
}

async function renderPdf(entry: PdfEntry, options: FetchOptions): Promise<string> {
  const notes: string[] = [];
  if (options.save && options.saveDir) {
    try {
      // A paper that names no DOI: its file name needs the authors and year a title search finds
      if (entry.meta.source === "pdf") entry.meta = (await metaByTitle(getClient(), entry.pdf)) ?? entry.meta;
      const dir = await options.saveDir();
      savePermanently(entry, dir, paperFileName(entry.meta, entry.url));
    } catch (error: unknown) {
      // the download and the working copy are fine; only keeping the file failed
      notes.push(`**Save failed:** ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (options.pages) {
    const pages = parsePageSpec(options.pages, entry.pdf.totalPages);
    if (typeof pages === "string") notes.push(`**Pages:** ${pages}. Showing the overview instead.`);
    else return [...notes, formatPages(entry, pages)].join("\n\n");
  }
  return [...notes, formatOverview(entry)].join("\n\n");
}

export async function fetchUrl(url: string, options: FetchOptions = {}): Promise<FetchResult> {
  // Normalize URL
  let normalizedUrl = url.trim();
  if (!/^https?:\/\//i.test(normalizedUrl)) {
    normalizedUrl = "https://" + normalizedUrl;
  }
  const pdfOnly =
    options.pages || options.save ? "**Note:** `pages` and `save` apply to PDFs only; this is not a PDF.\n\n" : "";

  // A PDF fetched earlier in this session: pages come from the working copy, no second download
  const known = getEntry(normalizedUrl);
  if (known) {
    const { content, truncated } = truncate(await renderPdf(known, options));
    // not "cached": the working copy lives for the session, not for the 15-minute cache
    return { content, url: known.url, status: 200, contentType: "application/pdf", cached: false, truncated };
  }

  // Check cache
  const cached = cacheGet(normalizedUrl);
  if (cached !== null) {
    return {
      content: pdfOnly + cached,
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

  // Also PDFs a server labels application/octet-stream: recognised by their %PDF- signature
  if (contentType.includes("application/pdf") || isPdf(resp.body)) {
    let pdf;
    try {
      pdf = await parsePdf(resp.body);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: `[PDF, ${resp.body.length} bytes: could not be parsed (${message})]`,
        url: finalUrl,
        status: resp.status,
        contentType,
        cached: false,
        truncated: false,
      };
    }
    const meta = (await metaByDoi(koon, finalUrl, pdf)) ?? metaFromPdf(pdf);
    const entry = addEntry([normalizedUrl, finalUrl], resp.body, pdf, meta);
    const { content, truncated } = truncate(await renderPdf(entry, options));
    return { content, url: finalUrl, status: resp.status, contentType, cached: false, truncated };
  }

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

  const t = truncate(content);

  // Cache the result
  cacheSet(normalizedUrl, t.content);

  return {
    content: pdfOnly + t.content,
    url: finalUrl,
    status: resp.status,
    contentType,
    cached: false,
    truncated: t.truncated,
  };
}
