// 文件工具：读 / 写 / 编辑 / 列目录。路径相对当前工作目录解析。
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Tool } from "../types.js";

const abs = (p: string) => path.resolve(process.cwd(), p);

export const readFile: Tool = {
  name: "read_file",
  description: "读取一个文本文件的全部内容。",
  parameters: {
    type: "object",
    properties: { path: { type: "string", description: "文件路径，相对工作目录" } },
    required: ["path"],
  },
  async execute(input) {
    const content = await fs.readFile(abs(String(input.path)), "utf8");
    // 太大就截断，别爆上下文。
    return content.length > 20_000 ? content.slice(0, 20_000) + "\n…（已截断）" : content;
  },
};

export const writeFile: Tool = {
  name: "write_file",
  description: "把内容写入文件（覆盖已存在的）。会创建缺失的目录。",
  dangerous: true,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" },
    },
    required: ["path", "content"],
  },
  async execute(input) {
    const target = abs(String(input.path));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, String(input.content), "utf8");
    return `已写入 ${input.path}（${String(input.content).length} 字符）`;
  },
};

export const editFile: Tool = {
  name: "edit_file",
  description: "把文件里的一段文本替换成新文本。old_string 必须在文件中唯一出现，否则报错。",
  dangerous: true,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      old_string: { type: "string", description: "要被替换的原文，必须唯一" },
      new_string: { type: "string", description: "替换后的新文本" },
    },
    required: ["path", "old_string", "new_string"],
  },
  async execute(input) {
    const target = abs(String(input.path));
    const content = await fs.readFile(target, "utf8");
    const old = String(input.old_string);
    const parts = content.split(old);
    if (parts.length === 1) throw new Error("old_string 在文件中未找到");
    if (parts.length > 2) throw new Error(`old_string 出现 ${parts.length - 1} 次，不唯一`);
    await fs.writeFile(target, parts.join(String(input.new_string)), "utf8");
    return `已编辑 ${input.path}`;
  },
};

export const listDir: Tool = {
  name: "list_dir",
  description: "列出某个目录下的文件和子目录。",
  parameters: {
    type: "object",
    properties: { path: { type: "string", description: "目录路径，默认当前目录" } },
  },
  async execute(input) {
    const dir = abs(String(input.path ?? "."));
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.name !== "node_modules" && e.name !== ".git")
      .map((e) => (e.isDirectory() ? e.name + "/" : e.name))
      .join("\n");
  },
};
