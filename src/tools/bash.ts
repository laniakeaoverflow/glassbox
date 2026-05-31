// bash 工具（仿 Claude Code）：
//  - 前台命令：跑完即返回（在命令进程退出时返回，不等后台子进程关管道）；30 秒超时。
//  - run_in_background=true：交给后台注册表管理，立即返回一个 id；
//    之后用 bash_output 读输出、kill_shell 终止。这是起服务器等常驻进程的正确方式。
import { spawn } from "node:child_process";
import type { Tool } from "../types.js";
import { startBackground, readBackground, killBackground } from "./shells.js";

const TIMEOUT_MS = 30_000;
const MAX_OUTPUT = 10_000;

export const bash: Tool = {
  name: "bash",
  description:
    "执行一条 shell 命令，返回 stdout+stderr。常驻进程（如启动 web 服务器）必须设 run_in_background=true——它会立即返回一个后台任务 id，之后用 bash_output 工具查看输出来确认是否正常启动。前台命令有 30 秒超时。不要用 sleep 空等。",
  dangerous: true,
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "要执行的命令" },
      run_in_background: {
        type: "boolean",
        description: "设为 true 在后台运行（用于服务器等常驻进程），立即返回任务 id；默认 false",
      },
    },
    required: ["command"],
  },
  execute(input) {
    const command = String(input.command);

    // —— 后台模式：登记到注册表，立即返回 ——
    if (input.run_in_background) {
      const s = startBackground(command, process.cwd());
      return Promise.resolve(
        `已在后台启动，任务 id: ${s.id}\n用 bash_output 工具（id="${s.id}"）查看输出确认是否正常，用 kill_shell（id="${s.id}"）终止。`
      );
    }

    // —— 前台模式：跑完即返回 ——
    return new Promise<string>((resolve) => {
      const child = spawn(command, { shell: true, cwd: process.cwd(), detached: true });
      let out = "";
      let done = false;
      const finish = (suffix = "") => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        child.stdout?.removeAllListeners("data");
        child.stderr?.removeAllListeners("data");
        child.stdout?.resume();
        child.stderr?.resume();
        child.unref();
        let s = out + suffix;
        if (s.length > MAX_OUTPUT) s = s.slice(0, MAX_OUTPUT) + "\n…（输出已截断）";
        resolve(s.trim() || "（无输出，命令已执行）");
      };
      child.stdout?.on("data", (d) => (out += d));
      child.stderr?.on("data", (d) => (out += d));
      child.on("exit", (code) => finish(code ? `\n[退出码 ${code}]` : ""));
      child.on("error", (e) => finish(`\n[启动失败: ${e.message}]`));
      const timer = setTimeout(() => {
        try {
          if (child.pid) process.kill(-child.pid, "SIGKILL");
        } catch {
          /* 已退出 */
        }
        finish(`\n[超时 ${TIMEOUT_MS}ms，已终止。常驻进程请改用 run_in_background]`);
      }, TIMEOUT_MS);
    });
  },
};

export const bashOutput: Tool = {
  name: "bash_output",
  description: "查看某个后台任务（bash run_in_background 返回的 id）到目前为止的输出，可用 filter 正则过滤。用它来验证服务器等后台进程是否正常启动。",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "后台任务 id，如 bg_1" },
      filter: { type: "string", description: "可选：只返回匹配该正则的行" },
    },
    required: ["id"],
  },
  async execute(input) {
    return readBackground(String(input.id), input.filter ? String(input.filter) : undefined);
  },
};

export const killShell: Tool = {
  name: "kill_shell",
  description: "终止一个后台任务（bash run_in_background 返回的 id），连同它启动的子进程一起。",
  parameters: {
    type: "object",
    properties: { id: { type: "string", description: "后台任务 id，如 bg_1" } },
    required: ["id"],
  },
  async execute(input) {
    return killBackground(String(input.id));
  },
};
