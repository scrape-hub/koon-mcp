import koonjs from "koonjs";
const { Koon } = koonjs;
import { htmlToMarkdown } from "./html-to-markdown.js";
import { fetchStackExchange, stackExchangeLink } from "./stackexchange.js";
import { cacheGet, cacheSet } from "./cache.js";
import { isPdf, parsePageSpec, parsePdf } from "./pdf.js";
import { metaByDoi, metaByTitle, metaFromPdf, paperFileName } from "./pdf-meta.js";
import { addEntry, getEntry, savePermanently, type PdfEntry } from "./pdf-store.js";
import { formatOverview, formatPages } from "./pdf-format.js";

const MAX_CONTENT_LENGTH = 100_000;
const MIN_PAGE_TEXT = 300;

// A site that turns away a request as Chrome often lets it through as Firefox or Safari
const BROWSERS = ["chrome", "firefox", "safari-mobile"] as const;
type Browser = (typeof BROWSERS)[number];
const BROWSER_NAMES: Record<Browser, string> = { chrome: "Chrome", firefox: "Firefox", "safari-mobile": "Safari" };

// The language of this machine, as the browser on it sends it
const LOCALE = systemLocale();

function systemLocale(): string | undefined {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale.split("-u-")[0];
  return /^[a-z]{2,3}(-[A-Z]{2})?$/.test(locale) ? locale : undefined;
}

type Client = InstanceType<typeof Koon>;
type Response = Awaited<ReturnType<Client["get"]>>;
const clients = new Map<Browser, Client>();

function getClient(browser: Browser = "chrome"): Client {
  let client = clients.get(browser);
  if (!client) {
    client = new Koon({
      // Without a version: the newest browser koon knows, a pinned one falls behind the real browser
      browser,
      locale: LOCALE,
      timeout: 30,
      followRedirects: true,
      maxRedirects: 10,
    });
    clients.set(browser, client);
  }
  return client;
}

const BLOCK_NAMES: Record<NonNullable<Response["blockedBy"]>, string> = {
  cloudflare: "a Cloudflare challenge",
  akamai: "an Akamai challenge",
  datadome: "a DataDome captcha",
  perimeterx: "a PerimeterX challenge",
  "aws-waf": "an AWS WAF challenge",
  imperva: "an Imperva challenge",
  kasada: "a Kasada challenge",
  baleen: "a Baleen challenge",
  google: "Google's bot check",
  amazon: "Amazon's captcha",
  javascript: "a JavaScript challenge",
  "block-page": "a block page",
  consent: "a cookie consent page",
};

/** Why a response is not the page itself, or null when it is. */
function blockReason(resp: Response): string | null {
  if (resp.blockedBy) return BLOCK_NAMES[resp.blockedBy] + (resp.blockedBy === "block-page" ? pageTitle(resp) : "");
  // Another browser may still get the page where this one was refused without a named bot protection
  if ([401, 403, 429, 503].includes(resp.status)) return `HTTP ${resp.status}${pageTitle(resp)}`;
  return null;
}

/** The first browser's response that is the page itself, else the last one with the reason it is not. */
async function fetchPage(url: string): Promise<{ resp: Response; browser: Browser; block: string | null }> {
  let result!: { resp: Response; browser: Browser; block: string | null };
  for (const browser of BROWSERS) {
    const resp = await getClient(browser).get(url);
    result = { resp, browser, block: blockReason(resp) };
    if (!result.block) break;
  }
  return result;
}

function pageTitle(resp: Response): string {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(resp.text().slice(0, 100_000))?.[1];
  return title ? ` (page title: "${title.replace(/\s+/g, " ").trim().slice(0, 80)}")` : "";
}

export interface FetchOptions {
  /** PDF pages to return, e.g. "5-8" or "1,4,9-11". */
  pages?: string;
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
  /** How the content was fetched when not directly as Chrome. */
  via?: string;
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

  const se = stackExchangeLink(normalizedUrl);
  if (se) {
    try {
      const { markdown, url: link } = await fetchStackExchange(getClient(), se);
      const t = truncate(markdown);
      cacheSet(normalizedUrl, t.content);
      return { content: pdfOnly + t.content, url: link, status: 200, contentType: "text/markdown", cached: false, truncated: t.truncated, via: "the Stack Exchange API" };
    } catch {
      // API quota used up or unreachable: fetch the page itself
    }
  }

  const { resp, browser, block } = await fetchPage(normalizedUrl);
  if (block) {
    throw new Error(`${new URL(resp.url).hostname} turned away the request as Chrome, Firefox and Safari: ${block}`);
  }
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} fetching ${resp.url}${pageTitle(resp)}`);
  }
  const via = browser === "chrome" ? undefined : `${BROWSER_NAMES[browser]} (the site turned away the request as Chrome)`;

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
    const meta = (await metaByDoi(getClient(), finalUrl, pdf)) ?? metaFromPdf(pdf);
    const entry = addEntry([normalizedUrl, finalUrl], resp.body, pdf, meta);
    const { content, truncated } = truncate(await renderPdf(entry, options));
    return { content, url: finalUrl, status: resp.status, contentType, cached: false, truncated, via };
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
    const page = htmlToMarkdown(resp.text(), finalUrl);
    content = page.markdown.trim();
    // Markup that dwarfs the text: the page fills itself in with JavaScript, unlike a small static page
    if (content.length < MIN_PAGE_TEXT && resp.text().length > 20 * Math.max(content.length, 100)) {
      const description = page.description ? `\n\n**Page description:** ${page.description}` : "";
      content = `${content}\n\n**Note:** this page builds its content with JavaScript; its HTML holds no more text than this.${description}`.trim();
    }
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
    via,
  };
}
