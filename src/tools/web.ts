// web_fetch 工具：抓取一个 URL，返回正文文本（去 HTML 标签、截断）。让 agent 能上网查资料。
import type { Tool } from "../types.js";

const MAX = 10_000;

/** 粗略地把 HTML 转成可读文本：去掉 script/style、去标签、解实体、压空白。 */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const webFetch: Tool = {
  name: "web_fetch",
  description: "抓取一个网页 URL，返回其正文文本（自动去掉 HTML 标签、超长截断）。用于查资料/读文档。",
  parameters: {
    type: "object",
    properties: { url: { type: "string", description: "要抓取的网址，必须以 http:// 或 https:// 开头" } },
    required: ["url"],
  },
  async execute(input) {
    const url = String(input.url);
    if (!/^https?:\/\//i.test(url)) throw new Error("url 必须以 http:// 或 https:// 开头");
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { "user-agent": "glassbox/0.x (+https://github.com/laniakeaoverflow/glassbox)" },
    });
    if (!res.ok) return `HTTP ${res.status} ${res.statusText}`;
    const ct = res.headers.get("content-type") ?? "";
    let body = await res.text();
    if (ct.includes("html")) body = htmlToText(body);
    body = body.trim();
    return body.length > MAX ? body.slice(0, MAX) + "\n…（已截断）" : body || "（页面无文本内容）";
  },
};
