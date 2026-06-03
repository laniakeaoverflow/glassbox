// 启动时给模型注入的一条 system-reminder：当前目录 + git 状态快照。
// 对齐真 Claude Code 会话开头注入 gitStatus 的做法——让模型一上来就知道工作区现状。
import { execSync } from "node:child_process";

function git(cmd: string, cwd: string): string {
  try {
    return execSync(`git ${cmd}`, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

/** 组装 cwd + git 分支/状态文本。非 git 仓库则只给目录。 */
export function envContext(cwd: string): string {
  const branch = git("rev-parse --abbrev-ref HEAD", cwd);
  if (!branch) return `工作目录：${cwd}\n（非 git 仓库）`;
  const status = git("status --short", cwd);
  const lines = [`工作目录：${cwd}`, `git 分支：${branch}`];
  lines.push(status ? `git 状态（启动快照）：\n${status}` : "git 状态：工作区干净");
  return lines.join("\n");
}
