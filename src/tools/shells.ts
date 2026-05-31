// 后台进程注册表——仿 Claude Code 的做法：后台命令是受管理的一等公民。
// 关键：把后台进程的 stdout/stderr 重定向到一个临时文件（而不是继承会随 CLI 退出而断的管道），
// 所以它不会因为 BrokenPipe 卡死；同时登记一个 id，可随时读输出、可按 id 终止。
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface BgShell {
  id: string;
  command: string;
  child: ChildProcess;
  logPath: string;
  status: "running" | "exited" | "killed";
  exitCode: number | null;
}

const shells = new Map<string, BgShell>();
let counter = 0;

/** 启动一个后台命令，立即返回它的句柄（不等它结束）。 */
export function startBackground(command: string, cwd: string): BgShell {
  const id = `bg_${++counter}`;
  const logPath = path.join(os.tmpdir(), `mcc-${id}.log`);
  const fd = fs.openSync(logPath, "w"); // 输出写文件，和 CLI 的管道彻底解耦
  // detached：自成进程组，可整组终止、也能脱离 CLI 独立存活。
  const child = spawn(command, { shell: true, cwd, detached: true, stdio: ["ignore", fd, fd] });
  fs.closeSync(fd); // 子进程已持有 fd 副本，父进程关掉自己的

  const shell: BgShell = { id, command, child, logPath, status: "running", exitCode: null };
  child.on("exit", (code) => {
    if (shell.status !== "killed") shell.status = "exited";
    shell.exitCode = code;
  });
  child.unref(); // 不让后台进程拖住 CLI 的事件循环
  shells.set(id, shell);
  return shell;
}

/** 读取某个后台命令到目前为止的输出（可选正则过滤）。 */
export function readBackground(id: string, filter?: string): string {
  const s = shells.get(id);
  if (!s) return `未找到后台任务 ${id}（用过的 id：${[...shells.keys()].join(", ") || "无"}）`;
  let out = "";
  try {
    out = fs.readFileSync(s.logPath, "utf8");
  } catch {
    /* 文件还没内容 */
  }
  if (filter) {
    const re = new RegExp(filter);
    out = out.split("\n").filter((l) => re.test(l)).join("\n");
  }
  const status =
    s.status === "running" ? "运行中" : s.status === "killed" ? "已终止" : `已退出(码 ${s.exitCode})`;
  return `[${id} · ${status}] ${s.command}\n--- 输出 ---\n${out.trim() || "(暂无输出)"}`;
}

/** 终止某个后台命令（连同它起的子进程）。 */
export function killBackground(id: string): string {
  const s = shells.get(id);
  if (!s) return `未找到后台任务 ${id}`;
  if (s.status !== "running") return `${id} 已经不在运行（${s.status}）`;
  try {
    if (s.child.pid) process.kill(-s.child.pid, "SIGTERM"); // 杀整个进程组
    s.status = "killed";
    return `已终止后台任务 ${id}`;
  } catch (e) {
    return `终止 ${id} 失败：${(e as Error).message}`;
  }
}

/** CLI 退出时统一回收所有还在跑的后台进程（仿 Claude Code 的会话级清理）。 */
export function killAllBackground(): void {
  for (const s of shells.values()) {
    if (s.status === "running" && s.child.pid) {
      try {
        process.kill(-s.child.pid, "SIGTERM");
      } catch {
        /* 已退出 */
      }
    }
  }
}
