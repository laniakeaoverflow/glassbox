// 搜索工具：grep（按内容匹配）+ glob（按文件名匹配）。
// 纯 Node 实现，递归遍历，跳过 node_modules/.git，结果有上限。
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Tool } from "../types.js";

const SKIP = new Set(["node_modules", ".git", "dist"]);
const MAX_HITS = 50;

/** 递归收集所有文件路径（相对工作目录）。 */
async function walk(dir: string, base: string, out: string[]): Promise<void> {
  if (out.length > 5000) return;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, base, out);
    else out.push(path.relative(base, full));
  }
}

export const grep: Tool = {
  name: "grep",
  description: "在工作目录下所有文本文件里按正则搜索，返回 文件:行号:内容。",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "正则表达式" },
      path: { type: "string", description: "限定的起始目录，默认当前目录" },
    },
    required: ["pattern"],
  },
  async execute(input) {
    const base = process.cwd();
    const start = path.resolve(base, String(input.path ?? "."));
    const files: string[] = [];
    await walk(start, base, files);
    const re = new RegExp(String(input.pattern));
    const hits: string[] = [];
    for (const f of files) {
      if (hits.length >= MAX_HITS) break;
      let text;
      try {
        text = await fs.readFile(path.join(base, f), "utf8");
      } catch {
        continue; // 二进制/读不了就跳过
      }
      text.split("\n").forEach((line, i) => {
        if (hits.length < MAX_HITS && re.test(line)) hits.push(`${f}:${i + 1}:${line.trim().slice(0, 200)}`);
      });
    }
    return hits.length ? hits.join("\n") : "（无匹配）";
  },
};

export const glob: Tool = {
  name: "glob",
  description: "按文件名通配符（* 和 ?）查找文件，如 *.ts 或 src/**。",
  parameters: {
    type: "object",
    properties: { pattern: { type: "string", description: "通配符，* 匹配任意字符" } },
    required: ["pattern"],
  },
  async execute(input) {
    const base = process.cwd();
    const files: string[] = [];
    await walk(base, base, files);
    // 把通配符转成正则：* -> .*，? -> .
    const re = new RegExp("^" + String(input.pattern).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
    const matched = files.filter((f) => re.test(f) || re.test(path.basename(f))).slice(0, MAX_HITS);
    return matched.length ? matched.join("\n") : "（无匹配）";
  },
};
