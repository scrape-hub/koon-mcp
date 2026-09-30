import { fragmentToMarkdown } from "./html-to-markdown.js";

const SITE = /^(?:[a-z]+\.)?(?:stackoverflow\.com|superuser\.com|serverfault\.com|askubuntu\.com|mathoverflow\.net|stackapps\.com)$|^[a-z0-9-]+\.stackexchange\.com$/;
const API = "https://api.stackexchange.com/2.3";
const MAX_ANSWERS = 10;

export interface StackExchangeLink {
  site: string;
  question?: number;
  answer?: number;
}

interface JsonClient {
  get(url: string): Promise<{ ok: boolean; status: number; text(): string }>;
}

/** A question or answer link on a Stack Exchange site, or null. */
export function stackExchangeLink(url: string): StackExchangeLink | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const site = u.hostname.replace(/^www\./, "");
  const m = /^\/(questions|q|a)\/(\d+)/.exec(u.pathname);
  if (!SITE.test(site) || !m) return null;
  return m[1] === "a" ? { site, answer: Number(m[2]) } : { site, question: Number(m[2]) };
}

async function api(client: JsonClient, path: string): Promise<any[]> {
  const r = await client.get(`${API}${path}`);
  const data = JSON.parse(r.text());
  if (!r.ok || data.error_id) throw new Error(data.error_message ?? `HTTP ${r.status}`);
  return data.items ?? [];
}

/** The question and its highest-voted answers as Markdown, from the Stack Exchange API. */
export async function fetchStackExchange(client: JsonClient, link: StackExchangeLink): Promise<{ markdown: string; url: string }> {
  const site = encodeURIComponent(link.site);
  let id = link.question;
  if (id === undefined) {
    const [answer] = await api(client, `/answers/${link.answer}?site=${site}&filter=withbody`);
    if (!answer) throw new Error("answer not found");
    id = answer.question_id;
  }
  const [q] = await api(client, `/questions/${id}?site=${site}&filter=withbody`);
  if (!q) throw new Error("question not found");
  const answers = await api(client, `/questions/${id}/answers?site=${site}&filter=withbody&sort=votes&order=desc&pagesize=${MAX_ANSWERS}`);
  if (q.accepted_answer_id && !answers.some((a) => a.answer_id === q.accepted_answer_id)) {
    answers.push(...(await api(client, `/answers/${q.accepted_answer_id}?site=${site}&filter=withbody`)));
  }

  const out = [
    `# ${fragmentToMarkdown(q.title)}`,
    "",
    `**Score:** ${q.score} | **Answers:** ${q.answer_count} | **Tags:** ${q.tags.join(", ")}`,
    "",
    fragmentToMarkdown(q.body ?? ""),
  ];
  for (const a of answers.filter((a) => a.body)) {
    const by = fragmentToMarkdown(a.owner?.display_name ?? "unknown");
    out.push("", `## Answer by ${by}, score ${a.score}${a.is_accepted ? ", accepted" : ""}`, "", fragmentToMarkdown(a.body));
  }
  if (q.answer_count > answers.length) out.push("", `[${q.answer_count - answers.length} more answers on the page]`);
  return { markdown: out.join("\n"), url: q.link };
}
