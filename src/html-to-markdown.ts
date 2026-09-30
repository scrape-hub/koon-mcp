import jsdom from "jsdom";
const { JSDOM, VirtualConsole } = jsdom;
import readability from "@mozilla/readability";
const { Readability } = readability;
import TurndownService from "turndown";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

// Remove elements that provide no textual value and waste tokens
turndown.remove(["img", "script", "style", "iframe", "video", "audio"]);

export interface Page {
  markdown: string;
  /** meta description or og:description */
  description: string;
}

export function htmlToMarkdown(html: string, url: string): Page {
  // A console of its own: the page's CSS and script errors would otherwise go to
  // stderr as stack traces on every fetch.
  const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() });
  const doc = dom.window.document;
  const description =
    doc.querySelector('meta[property="og:description"]')?.getAttribute("content") ??
    doc.querySelector('meta[name="description"]')?.getAttribute("content") ??
    "";

  // Try Readability first for clean article extraction
  const reader = new Readability(doc);
  const article = reader.parse();

  let content: string;
  if (article && article.content) {
    content = turndown.turndown(article.content);
    if (article.title) {
      content = `# ${article.title}\n\n${content}`;
    }
  } else {
    // Fallback: convert the entire body
    const body = doc.querySelector("body");
    content = body ? turndown.turndown(body.innerHTML) : "";
  }

  return { markdown: content, description: description.trim() };
}

export function fragmentToMarkdown(html: string): string {
  return turndown.turndown(html);
}
