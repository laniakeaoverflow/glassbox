// 记忆模块（仿 Claude Code 的多层记忆）。解决 LLM「每次会话都失忆」的问题：把该记住的东西
// 跨会话带过去，自动注入系统提示。两族：
//  1. 静态记忆（人写的，像 CLAUDE.md）：~/.glassbox/GLASSBOX.md（全局）+ ./GLASSBOX.md（项目）
//  2. agent 记忆（它自己写的，像 auto memory）：remember 工具把经验追加进本项目的 MEMORY.md
import { promises as fs } from "node:fs";
import fss from "node:fs";
import os from "node:os";
import path from "node:path";

/** 记忆根目录（和 .env / logs 一样放 ~/.glassbox，可用 GLASSBOX_DIR 覆盖以便测试）。 */
function root(): string {
  return process.env.GLASSBOX_DIR || path.join(os.homedir(), ".glassbox");
}

/** 把工作目录变成一个安全的子目录名，做到「按项目」存 agent 记忆（仿 Claude Code 的 per-project）。 */
function projectKey(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "root";
}

export function agentMemoryPath(cwd: string): string {
  return path.join(root(), "memory", projectKey(cwd), "MEMORY.md");
}

function readIfExists(p: string): string {
  try {
    return fss.readFileSync(p, "utf8").trim();
  } catch {
    return "";
  }
}

const cap = (s: string, n = 4000) => (s.length > n ? s.slice(0, n) + "\n…（记忆过长已截断）" : s);

/** 三个记忆来源的路径（给 /memory 命令展示用）。 */
export function memorySources(cwd: string): string[] {
  return [path.join(root(), "GLASSBOX.md"), path.join(cwd, "GLASSBOX.md"), agentMemoryPath(cwd)];
}

/** 加载要注入系统提示的记忆。无任何记忆时返回空串。 */
export function loadMemory(cwd: string): string {
  const parts: { label: string; text: string }[] = [];
  const userStatic = readIfExists(path.join(root(), "GLASSBOX.md"));
  if (userStatic) parts.push({ label: "用户全局记忆 (~/.glassbox/GLASSBOX.md)", text: cap(userStatic) });
  const projStatic = readIfExists(path.join(cwd, "GLASSBOX.md"));
  if (projStatic) parts.push({ label: "项目记忆 (./GLASSBOX.md)", text: cap(projStatic) });
  const agentMem = readIfExists(agentMemoryPath(cwd));
  if (agentMem) parts.push({ label: "历史会话学到的经验 (MEMORY.md)", text: cap(agentMem) });
  if (parts.length === 0) return "";
  return "\n\n# 记忆（背景信息，跨会话保留）\n" + parts.map((p) => `## ${p.label}\n${p.text}`).join("\n\n");
}

/** agent 调用 remember 时，把一条笔记追加进本项目的 MEMORY.md。 */
export async function remember(cwd: string, note: string): Promise<string> {
  const clean = note.trim().replace(/\s+/g, " ");
  if (!clean) return "（笔记为空，未记录）";
  const p = agentMemoryPath(cwd);
  await fs.mkdir(path.dirname(p), { recursive: true });
  const line = `- ${clean}\n`;
  if (fss.existsSync(p)) await fs.appendFile(p, line, "utf8");
  else await fs.writeFile(p, `# glassbox 记忆 · ${cwd}\n\n${line}`, "utf8");
  return `已记住：${clean.slice(0, 80)}`;
}
