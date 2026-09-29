import type { PdfEntry } from "./pdf-store.js";

export const MAX_PAGES_PER_CALL = 20;
// Below the fetcher's 100,000-character cut, so a response never ends in the middle of a page
const PAGES_TEXT_CHARS = 95_000;
// Text of the first pages in the overview: about 4,000 tokens
const OVERVIEW_TEXT_CHARS = 16_000;
const MAX_AUTHORS_SHOWN = 10;

function pageText(entry: PdfEntry, page: number): string {
  const t = entry.pdf.pages[page - 1];
  return t ? t : "[No text on this page: a scan, an image or an empty page.]";
}

function header(entry: PdfEntry): string[] {
  const { meta, pdf } = entry;
  const lines = [`**PDF:** ${pdf.totalPages} page${pdf.totalPages === 1 ? "" : "s"}`];
  if (meta.title) lines.push(`**Title:** ${meta.title}`);
  if (meta.authors.length) {
    const shown = meta.authors.slice(0, MAX_AUTHORS_SHOWN).join(", ");
    const more = meta.authors.length > MAX_AUTHORS_SHOWN ? `, et al. (${meta.authors.length} authors)` : "";
    lines.push(`**Authors:** ${shown}${more}`);
  }
  const yd = [meta.year && `**Year:** ${meta.year}`, meta.doi && `**DOI:** ${meta.doi}`].filter(Boolean);
  if (yd.length) lines.push(yd.join(" · "));
  lines.push(entry.savedPath ? `**Saved:** ${entry.savedPath}` : `**Working copy:** ${entry.file} (deleted when the session ends)`);
  return lines;
}

/**
 * The text from page 1 on, as much as OVERVIEW_TEXT_CHARS allows: a short PDF comes whole, a long one
 * with its outline and a pointer to `pages` for the rest.
 */
export function formatOverview(entry: PdfEntry): string {
  const { pdf } = entry;
  const out = header(entry);
  const textPages = pdf.pages.filter((t) => t.length > 0).length;
  if (textPages === 0) {
    out.push("", "**No text layer:** the PDF is probably a scan. Its pages can be read as images from the file above.");
    return out.join("\n");
  }
  const body: string[] = [];
  let budget = OVERVIEW_TEXT_CHARS;
  let next = 1; // the first page not shown in full
  while (next <= pdf.totalPages && budget > 0) {
    const t = pageText(entry, next);
    if (t.length > budget) {
      body.push("", `## Page ${next}`, "", `${t.slice(0, budget)}\n\n[Page ${next} continues]`);
      break;
    }
    body.push("", `## Page ${next}`, "", t);
    budget -= t.length;
    next++;
  }
  if (next <= pdf.totalPages) {
    out.push("", `Shown from page 1 on; read page ${next} onwards with \`pages\` (e.g. "${next}-${Math.min(next + 4, pdf.totalPages)}", up to ${MAX_PAGES_PER_CALL} per call).`);
    if (pdf.outline.length) {
      out.push("", "## Contents");
      for (const item of pdf.outline) {
        out.push(`${"  ".repeat(item.level - 1)}- ${item.title}${item.page ? ` (p. ${item.page})` : ""}`);
      }
    }
  }
  return [...out, ...body].join("\n");
}

/**
 * The text of the requested pages, each under a "## Page N" heading so statements can be cited by page.
 * Stops at whole pages: at most MAX_PAGES_PER_CALL, and before the text would outgrow the response limit.
 */
export function formatPages(entry: PdfEntry, pages: number[]): string {
  const out = header(entry);
  const body: string[] = [];
  let used = out.join("\n").length;
  let shown = 0;
  for (const p of pages.slice(0, MAX_PAGES_PER_CALL)) {
    const block = `\n\n## Page ${p}\n\n${pageText(entry, p)}`;
    if (shown > 0 && used + block.length > PAGES_TEXT_CHARS) break;
    body.push(block);
    used += block.length;
    shown++;
  }
  if (shown < pages.length) {
    const rest = pages.slice(shown);
    out.push(`**Note:** ${shown} of ${pages.length} requested pages shown; the rest are pages ${rest[0]}-${rest[rest.length - 1]}, ask for them in another call.`);
  }
  return out.join("\n") + body.join("");
}
