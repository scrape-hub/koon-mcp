import type { ParsedPdf } from "./pdf.js";

export interface PaperMeta {
  title: string;
  /** Family names in author order. */
  authors: string[];
  year: string;
  doi: string;
  /** Where title/authors/year came from. */
  source: "crossref" | "datacite" | "pdf";
}

/** Anything with a koonjs-like get(url) -> { ok, text() } */
export interface MetaClient {
  get(url: string, options?: { timeout?: number; headers?: Record<string, string> }): Promise<{ ok: boolean; text(): string }>;
}

const LOOKUP_TIMEOUT_S = 10;
// All registry lookups for one PDF together; a page full of cited DOIs must not stall the call
const LOOKUP_BUDGET_MS = 20_000;
const MAX_DOI_CANDIDATES = 5;
// A first page shorter than this is a cover or title page: the title and authors are on the next one
const COVER_PAGE_CHARS = 1_500;
const DOI_RE = /\b(10\.\d{4,9}\/[-._;()/:<>A-Za-z0-9]+)/g;

function cleanDoi(doi: string): string {
  return doi
    .replace(/[.,;:)\]>]+$/, "")
    .replace(/(\.full)?\.pdf$/i, "")
    .replace(/\/(full|pdf|epdf|abstract)$/i, "")
    // a preprint version ("…914952v2"); a "v" inside an identifier ("nar/gkv1003") stays
    .replace(/(?<=\d)v\d+$/i, "");
}

/** DOI candidates in order of trust: the URL first, then the first two pages, then arXiv ids. */
export function doiCandidates(url: string, pdf: ParsedPdf): string[] {
  const out: string[] = [];
  const add = (d: string) => {
    const c = cleanDoi(d);
    if (!out.some((x) => x.toLowerCase() === c.toLowerCase())) out.push(c);
  };
  let decoded = url;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    // keep the raw URL
  }
  for (const m of decoded.matchAll(DOI_RE)) add(m[1]);
  // A DOI wrapped at a line end is joined first: after its prefix ("…/10.1016/" + newline + "S0140-…")
  // or after a hyphen inside it ("S0140-" + newline + "6736(20)…")
  const head = pdf.pages
    .slice(0, 2)
    .join("\n")
    .replace(/(10\.\d{4,9}\/)\s*\n\s*/g, "$1")
    .replace(/(10\.\d{4,9}\/\S*-)\s*\n\s*/g, "$1");
  for (const m of head.matchAll(DOI_RE)) add(m[1]);
  const arxivIds = [...decoded.matchAll(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})/gi), ...head.matchAll(/arXiv:(\d{4}\.\d{4,5})/g)];
  for (const m of arxivIds) add(`10.48550/arXiv.${m[1]}`);
  return out.slice(0, MAX_DOI_CANDIDATES);
}

/** Lower case, accents and punctuation removed, hyphenated line breaks joined; any script. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/-\s*\n\s*/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Like norm, but line by line: the line breaks stay. */
function normLines(s: string): string {
  return s
    .replace(/-\s*\n\s*/g, "")
    .split("\n")
    .map((line) => norm(line))
    .join("\n");
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Between two words of a title or name: footnote digits glued to a word ("Zhou1") and the line
// numbers of preprints ("… outbreak in2" / "3 humans …") may sit in between
const GAP = "\\d*(?:[ \\n]\\d+)*[ \\n]";

function words(s: string): string[] {
  return norm(s)
    .split(" ")
    .filter((w) => w.length > 3);
}

/** Markup and entities as Crossref delivers them in titles ("<i>E. coli</i> CO<sub>2</sub> &amp; …"). */
function cleanTitle(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Page 1, plus page 2 when page 1 is only a cover. */
function titlePages(pdf: ParsedPdf): string {
  const first = pdf.pages[0] ?? "";
  return first.length < COVER_PAGE_CHARS ? `${first}\n${pdf.pages[1] ?? ""}` : first;
}

/** Both titles share most of their words: the same paper, not merely a similar one. */
function sameTitle(a: string, b: string): boolean {
  const wa = new Set(words(a));
  const wb = new Set(words(b));
  if (wa.size === 0 || wb.size === 0) return false;
  const common = [...wa].filter((w) => wb.has(w)).length;
  return common / wa.size >= 0.8 && common / wb.size >= 0.8;
}

/**
 * The registry record belongs to this PDF, not to a work it cites on its first page:
 * - the title (its first eight words, in order) starts a line of the title page; the title can sit
 *   anywhere on page 1 (PLOS and NEJM print it after 2,500 characters of header and summary), but in
 *   a reference entry it follows the authors on the same line
 * - the first author's family name is on the title page
 * - a real title in the PDF's own document info does not contradict it
 */
function belongsToPdf(meta: PaperMeta, pdf: ParsedPdf): boolean {
  const text = normLines(titlePages(pdf));
  const titleWords = norm(meta.title).split(" ").filter(Boolean).slice(0, 8);
  if (titleWords.length === 0) return false;
  const title = new RegExp(`(?:^|\\n)(?:\\d+[ \\n])*${titleWords.map(escapeRe).join(GAP)}\\d*(?:[ \\n]|$)`);
  if (!title.test(text)) return false;
  const firstAuthor = norm(meta.authors[0] ?? "").split(" ").filter(Boolean);
  if (firstAuthor.length && !new RegExp(`(?:^|[ \\n])${firstAuthor.map(escapeRe).join(GAP)}\\d*(?:[ \\n]|$)`).test(text)) {
    return false;
  }
  const info = words(pdf.infoTitle);
  if (info.length >= 4) {
    const mine = new Set(words(meta.title));
    if (info.filter((w) => mine.has(w)).length / info.length < 0.3) return false;
  }
  return true;
}

async function crossref(client: MetaClient, doi: string, timeout: number): Promise<PaperMeta | null> {
  const r = await client.get(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, { timeout });
  if (!r.ok) return null;
  const m = JSON.parse(r.text()).message ?? {};
  const title = cleanTitle(m.title?.[0] ?? "");
  if (!title) return null;
  const authors = (m.author ?? []).map((a: { family?: string; name?: string }) => (a.family ?? a.name ?? "").trim()).filter(Boolean);
  const year = String(m.issued?.["date-parts"]?.[0]?.[0] ?? m.published?.["date-parts"]?.[0]?.[0] ?? "");
  return { title, authors, year, doi, source: "crossref" };
}

async function datacite(client: MetaClient, doi: string, timeout: number): Promise<PaperMeta | null> {
  const r = await client.get(`https://api.datacite.org/dois/${encodeURIComponent(doi)}`, { timeout });
  if (!r.ok) return null;
  const a = JSON.parse(r.text()).data?.attributes ?? {};
  const title = cleanTitle(a.titles?.[0]?.title ?? "");
  if (!title) return null;
  const authors = (a.creators ?? [])
    .map((c: { familyName?: string; name?: string }) => (c.familyName ?? c.name?.split(",")[0] ?? "").trim())
    .filter(Boolean);
  return { title, authors, year: String(a.publicationYear ?? ""), doi, source: "datacite" };
}

/**
 * Title, authors, year and DOI from Crossref or DataCite, when the URL or the first pages name a DOI or
 * arXiv id whose record belongs to this PDF. Null for anything else: most PDFs are not papers.
 */
export async function metaByDoi(client: MetaClient, url: string, pdf: ParsedPdf): Promise<PaperMeta | null> {
  const deadline = Date.now() + LOOKUP_BUDGET_MS;
  const timeout = () => Math.max(1, Math.min(LOOKUP_TIMEOUT_S, (deadline - Date.now()) / 1000));
  for (const doi of doiCandidates(url, pdf)) {
    for (const lookup of [crossref, datacite]) {
      if (Date.now() >= deadline) return null;
      try {
        const meta = await lookup(client, doi, timeout());
        if (meta && belongsToPdf(meta, pdf)) return meta;
        if (meta) break; // the registry knows this DOI, but it is not this paper
      } catch {
        // registry unreachable or malformed answer: try the next source
      }
    }
  }
  return null;
}

/**
 * The same for a paper that names no DOI, found through OpenAlex by the title in its document info.
 * Only for saving, where the file name needs authors and year: a plain fetch sends no title to a registry.
 */
export async function metaByTitle(client: MetaClient, pdf: ParsedPdf): Promise<PaperMeta | null> {
  if (words(pdf.infoTitle).length < 3) return null;
  try {
    // OpenAlex ranks the paper first where Crossref's bibliographic search buries it under derived records
    const r = await client.get(`https://api.openalex.org/works?per-page=5&select=doi,title&search=${encodeURIComponent(pdf.infoTitle)}`, {
      timeout: LOOKUP_TIMEOUT_S,
    });
    if (!r.ok) return null;
    for (const item of JSON.parse(r.text()).results ?? []) {
      const doi = String(item.doi ?? "").replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
      if (doi && sameTitle(cleanTitle(item.title ?? ""), pdf.infoTitle)) {
        const meta = (await crossref(client, doi, LOOKUP_TIMEOUT_S)) ?? (await datacite(client, doi, LOOKUP_TIMEOUT_S));
        if (meta && belongsToPdf(meta, pdf)) return meta;
      }
    }
  } catch {
    // registry unreachable
  }
  return null;
}

/** What the PDF says about itself: only its title. Its author and date fields hold tool names and file dates too often. */
export function metaFromPdf(pdf: ParsedPdf): PaperMeta {
  return { title: pdf.infoTitle, authors: [], year: "", doi: "", source: "pdf" };
}

/** Zotero's default attachment name: "{firstCreator} - {year} - {title}" (title cut at 100 characters). */
export function paperFileName(meta: PaperMeta, url: string): string {
  const a = meta.authors;
  const creator = a.length === 0 ? "" : a.length === 1 ? a[0] : a.length === 2 ? `${a[0]} and ${a[1]}` : `${a[0]} et al.`;
  let title = meta.title.replace(/\s+/g, " ").trim();
  if (title.length > 100) title = title.slice(0, 100).replace(/\s+\S*$/, "");
  let name = [creator, meta.year, title].filter(Boolean).join(" - ");
  if (!title) {
    let base = "";
    try {
      base = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() ?? "");
    } catch {
      // no usable path segment
    }
    name = [name, base.replace(/\.pdf$/i, "")].filter(Boolean).join(" - ") || "document";
  }
  // characters Windows, macOS or Linux do not allow in file names
  name = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").replace(/\s+/g, " ").replace(/[. ]+$/, "").trim();
  // device names Windows reserves regardless of extension
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(name)) name += "_";
  return `${name || "document"}.pdf`;
}
