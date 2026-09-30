import { extractText, getDocumentProxy } from "unpdf";

export interface OutlineItem {
  title: string;
  page: number | null;
  level: number;
}

export interface ParsedPdf {
  totalPages: number;
  /** Text per page, index 0 = page 1. Empty string for a page without a text layer. */
  pages: string[];
  infoTitle: string;
  outline: OutlineItem[];
}

const OUTLINE_MAX_ITEMS = 60;
const OUTLINE_MAX_LEVEL = 3;

export function isPdf(body: Uint8Array): boolean {
  // "%PDF-": also PDFs a server labels application/octet-stream
  return body.length > 4 && body[0] === 0x25 && body[1] === 0x50 && body[2] === 0x44 && body[3] === 0x46 && body[4] === 0x2d;
}

/** Text per page, document info and outline. Throws when the file cannot be parsed. */
export async function parsePdf(body: Uint8Array): Promise<ParsedPdf> {
  // pdf.js takes ownership of the buffer it is given, so it works on a copy
  const pdf = await getDocumentProxy(new Uint8Array(body));
  try {
    return await read(pdf);
  } finally {
    // unpdf leaves a proxy it was handed to the caller: without this every PDF stays in memory
    await pdf.loadingTask.destroy();
  }
}

type PdfProxy = Awaited<ReturnType<typeof getDocumentProxy>>;

async function read(pdf: PdfProxy): Promise<ParsedPdf> {
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const pages = (text as string[]).map((t) => t.replace(/[ \t]+\n/g, "\n").trim());

  let infoTitle = "";
  try {
    const meta = await pdf.getMetadata();
    const info = (meta.info ?? {}) as { Title?: string };
    infoTitle = info.Title?.trim() ?? "";
    // layout and word-processing tools often leave a file name or a placeholder as the title
    if (/\.(indd|docx?|pdf|tex|dvi|qxd|rtf)$/i.test(infoTitle) || /^(microsoft word\b|untitled\b|document\d*$)/i.test(infoTitle) || /^\S*_\S*$/.test(infoTitle)) {
      infoTitle = "";
    }
  } catch {
    // document info is optional
  }

  const outline: OutlineItem[] = [];
  try {
    const root = await pdf.getOutline();
    const walk = async (items: typeof root, level: number) => {
      for (const item of items ?? []) {
        if (outline.length >= OUTLINE_MAX_ITEMS) return;
        let page: number | null = null;
        try {
          const dest = typeof item.dest === "string" ? await pdf.getDestination(item.dest) : item.dest;
          if (Array.isArray(dest) && dest[0]) page = (await pdf.getPageIndex(dest[0])) + 1;
        } catch {
          // an entry without a resolvable destination keeps page = null
        }
        outline.push({ title: item.title.trim(), page, level });
        if (level < OUTLINE_MAX_LEVEL && item.items?.length) await walk(item.items, level + 1);
      }
    };
    await walk(root, 1);
  } catch {
    // an outline that cannot be read is left out
  }

  return { totalPages, pages, infoTitle, outline };
}

/** Parses "5", "3-7", "1,4,9-11" into sorted unique page numbers within 1..total. */
export function parsePageSpec(spec: string, total: number): number[] | string {
  const out = new Set<number>();
  for (const part of spec.split(",").map((p) => p.trim()).filter(Boolean)) {
    // "3–7" with an en dash too, as models often write ranges
    const m = /^(\d+)\s*(?:[-–—]\s*(\d+))?$/.exec(part);
    if (!m) return `invalid page range "${part}" (use e.g. "5", "3-7" or "1,4,9-11")`;
    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : from;
    if (from < 1 || to < from) return `invalid page range "${part}"`;
    if (from > total) return `page ${from} does not exist, the PDF has ${total} page${total === 1 ? "" : "s"}`;
    for (let p = from; p <= Math.min(to, total); p++) out.add(p);
  }
  if (out.size === 0) return "no pages given";
  return [...out].sort((a, b) => a - b);
}
