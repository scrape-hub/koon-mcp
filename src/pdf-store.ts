import { createHash } from "node:crypto";
import { constants, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import type { ParsedPdf } from "./pdf.js";
import type { PaperMeta } from "./pdf-meta.js";

export interface PdfEntry {
  url: string;
  /** Working copy, deleted when the server exits. */
  file: string;
  sha256: string;
  pdf: ParsedPdf;
  meta: PaperMeta;
  /** Set once the PDF was saved permanently. */
  savedPath?: string;
}

function userTag(): string {
  try {
    return userInfo().username.replace(/[^A-Za-z0-9_-]/g, "") || "user";
  } catch {
    return "user";
  }
}

// Per user: on a shared Linux /tmp the folder of the first user would lock out every other one
const ROOT = join(tmpdir(), `koon-mcp-${userTag()}`);
const SESSION_DIR = join(ROOT, String(process.pid));
const entries = new Map<string, PdfEntry>();

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

// Working copies of servers that did not exit cleanly (crash, killed terminal)
try {
  for (const name of readdirSync(ROOT)) {
    const pid = Number(name);
    if (Number.isInteger(pid) && pid !== process.pid && !processAlive(pid)) {
      rmSync(join(ROOT, name), { recursive: true, force: true });
    }
  }
} catch {
  // no leftovers
}

process.on("exit", () => {
  try {
    rmSync(SESSION_DIR, { recursive: true, force: true });
  } catch {
    // a viewer still holds a working copy open (Windows): the next start removes the folder
  }
});
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => process.exit(0));
}

export function getEntry(url: string): PdfEntry | undefined {
  return entries.get(url);
}

/** Keeps a working copy of the PDF for the session so pages can be read without downloading it again. */
export function addEntry(urls: string[], body: Uint8Array, pdf: ParsedPdf, meta: PaperMeta): PdfEntry {
  mkdirSync(SESSION_DIR, { recursive: true });
  const sha256 = createHash("sha256").update(body).digest("hex");
  const file = join(SESSION_DIR, `${sha256.slice(0, 16)}.pdf`);
  if (!existsSync(file)) writeFileSync(file, body);
  const entry: PdfEntry = { url: urls[0], file, sha256, pdf, meta };
  for (const u of urls) entries.set(u, entry);
  return entry;
}

function sameFile(path: string, sha256: string): boolean {
  return createHash("sha256").update(readFileSync(path)).digest("hex") === sha256;
}

/**
 * Copies the working copy into dir under the given name. The same PDF saved twice stays one file;
 * a different PDF with the same name gets " (2)", " (3)", ...
 */
export function savePermanently(entry: PdfEntry, dir: string, fileName: string): string {
  mkdirSync(dir, { recursive: true });
  const stem = fileName.replace(/\.pdf$/i, "");
  for (let n = 1; ; n++) {
    const target = join(dir, n === 1 ? `${stem}.pdf` : `${stem} (${n}).pdf`);
    try {
      // COPYFILE_EXCL: another server saving into the same folder at the same moment cannot be overwritten
      copyFileSync(entry.file, target, constants.COPYFILE_EXCL);
      return (entry.savedPath = target);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    if (sameFile(target, entry.sha256)) return (entry.savedPath = target);
  }
}
