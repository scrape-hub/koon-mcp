import jsdom from "jsdom";
const { JSDOM } = jsdom;
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

export function htmlToMarkdown(html: string, url: string): string {
  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;

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

  return content;
}
