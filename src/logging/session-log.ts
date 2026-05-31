// 会话日志器：又一个事件总线的订阅者。每启动一次 CLI 就建一对文件——
//   <session>.jsonl  每行一个事件，全量（含原始请求/响应、完整工具结果），给程序化分析
//   <session>.log    可读转写（带时间戳，文本/工具参数完整，超长结果截断并指向 .jsonl）
// 默认存到 ~/.glassbox/logs/，可用 GLASSBOX_LOG_DIR 覆盖。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { bus } from "../events/bus.js";
import type { AgentEvent } from "../events/types.js";

export interface SessionLog {
  logPath: string;
  jsonlPath: string;
  close: () => void;
}

export function logDir(): string {
  return process.env.GLASSBOX_LOG_DIR || path.join(os.homedir(), ".glassbox", "logs");
}

export function startSessionLog(meta: { provider: string; model: string; cwd: string }): SessionLog {
  const dir = logDir();
  fs.mkdirSync(dir, { recursive: true });
  // 文件名带时间戳，每次启动各成一份
  const stamp = new Date().toISOString().replace(/[:.]/g, "-"); // 2026-05-31T08-30-22-123Z
  const base = path.join(dir, `session-${stamp}`);
  const logPath = base + ".log";
  const jsonlPath = base + ".jsonl";
  const log = fs.createWriteStream(logPath, { flags: "a" });
  const jsonl = fs.createWriteStream(jsonlPath, { flags: "a" });

  const startedAt = new Date().toISOString();
  log.write(`# glassbox 会话日志\n# 开始: ${startedAt}\n# provider: ${meta.provider}/${meta.model}\n# 目录: ${meta.cwd}\n# 完整原始数据见同名 .jsonl\n\n`);
  jsonl.write(JSON.stringify({ type: "session_start", ts: Date.parse(startedAt), ...meta }) + "\n");

  const off = bus.on((e) => {
    jsonl.write(JSON.stringify(e) + "\n"); // 全量
    const line = renderLine(e);
    if (line) log.write(line + "\n");
  });

  return {
    logPath,
    jsonlPath,
    close: () => {
      off();
      log.end();
      jsonl.end();
    },
  };
}

const t = (ts: number) => new Date(ts).toISOString().slice(11, 23); // HH:MM:SS.mmm
const cap = (s: string, n = 1500) => (s.length > n ? s.slice(0, n) + `\n…（截断，完整见 .jsonl，共 ${s.length} 字）` : s);

/** 把一个事件渲染成可读 .log 的一行（或多行）。返回 null 表示该事件在可读日志里略过。 */
function renderLine(e: AgentEvent): string | null {
  const pre = e.parentAgentId ? "    " : ""; // 子 agent 缩进
  const id = `[${e.agentId}]`;
  switch (e.type) {
    case "conversation_start":
      return `${pre}[${t(e.ts)}] ▶ ${id} 任务: ${e.task}`;
    case "llm_request":
      return `${pre}[${t(e.ts)}] · 调用 ${e.provider}/${e.model}（消息数 ${e.messageCount}）`;
    case "llm_response": {
      const head = `${pre}[${t(e.ts)}] ◆ ${e.provider}/${e.model} · ${e.latencyMs}ms · in ${e.inputTokens} / out ${e.outputTokens} tok · $${e.costUsd.toFixed(5)} · ${e.stopReason}`;
      return e.text.trim() ? `${head}\n${pre}  回复: ${e.text.trim()}` : head;
    }
    case "tool_start":
      return `${pre}[${t(e.ts)}] → 工具 ${e.name} ${JSON.stringify(e.args)}`;
    case "tool_result":
      return `${pre}[${t(e.ts)}]   ${e.ok ? "✓" : "✗"} ${e.durationMs}ms · 结果:\n${pre}  ${cap(e.result).replace(/\n/g, "\n" + pre + "  ")}`;
    case "permission_request":
      return `${pre}[${t(e.ts)}] ? 请求权限: ${e.name} ${JSON.stringify(e.args)}`;
    case "permission_resolved":
      return `${pre}[${t(e.ts)}] ! 权限: ${e.approved ? "同意" : "拒绝"}`;
    case "subagent_spawn":
      return `${pre}[${t(e.ts)}] ⑂ 派生子 agent ${e.childAgentId}: ${e.task}`;
    case "subagent_result":
      return `${pre}[${t(e.ts)}] ⑂ 子 agent ${e.childAgentId} 结束（${e.ok ? "成功" : "失败"}）`;
    case "conversation_end":
      return `${pre}[${t(e.ts)}] ■ ${id} 结束 · 共 in ${e.totalInputTokens} / out ${e.totalOutputTokens} tok · $${e.totalCostUsd.toFixed(5)}\n`;
    case "compaction":
      return `${pre}[${t(e.ts)}] 🗜 压缩上下文：${e.before} → ${e.after} 条消息`;
    case "error":
      return `${pre}[${t(e.ts)}] ‼ 错误 [${e.where}]: ${e.message}`;
    default:
      return null;
  }
}
