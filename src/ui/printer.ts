// 终端订阅者：把事件流打成人能看的彩色日志。和面板看的是同一条总线。
import { bus } from "../events/bus.js";
import type { AgentEvent } from "../events/types.js";

const C = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

/** 子 agent 缩进，让协作层级在终端里也看得出来。 */
const indent = (e: AgentEvent) => (e.parentAgentId ? "  │ " : "");

export function startPrinter(): () => void {
  // 流式打字状态：是否已往终端流式打印过本回合的正文（只对主 agent 生效）。
  // 用于 llm_response 时决定是否「换行+只打 meta」而不是重复打整段文本。
  let streamedText = false;

  return bus.on((e: AgentEvent) => {
    const p = indent(e);
    switch (e.type) {
      case "conversation_start":
        if (e.parentAgentId) console.log(p + C.dim(`↳ 子 agent 启动：${e.task.slice(0, 60)}`));
        break;
      case "llm_request":
        streamedText = false; // 新一轮调用开始，清零打字状态
        break;
      case "llm_delta":
        // 只对主 agent 实时打字（子 agent 会交织错乱，仍按回合在 llm_response 整段打）。
        if (!e.parentAgentId && e.kind === "text" && e.text) {
          if (!streamedText) process.stdout.write(C.cyan("◆ ")); // 首个增量前打一次前缀
          process.stdout.write(e.text);
          streamedText = true;
        }
        break;
      case "llm_response":
        if (streamedText) {
          process.stdout.write("\n"); // 流式正文已逐字打完，补个换行再接 meta
        } else if (e.text.trim()) {
          console.log(p + C.cyan("◆ ") + e.text.trim()); // 非流式/子 agent：整段打
        }
        console.log(p + C.dim(`  ${e.provider}/${e.model} · ${e.latencyMs}ms · in ${e.inputTokens} out ${e.outputTokens} tok · $${e.costUsd.toFixed(5)} · ${e.stopReason}`));
        streamedText = false;
        break;
      case "tool_start":
        console.log(p + C.yellow("→ ") + C.bold(e.name) + C.dim(" " + oneLine(e.args)));
        break;
      case "tool_result":
        console.log(p + (e.ok ? C.green("  ✓ ") : C.red("  ✗ ")) + C.dim(`${e.durationMs}ms · ${oneLine(e.resultPreview)}`));
        break;
      case "subagent_spawn":
        console.log(p + C.dim(`  spawn → ${e.childAgentId}`));
        break;
      case "conversation_end":
        if (!e.parentAgentId)
          console.log(C.dim(`— 结束 · 共 in ${e.totalInputTokens} out ${e.totalOutputTokens} tok · $${e.totalCostUsd.toFixed(5)} —`));
        break;
      case "todo_update": {
        const done = e.todos.filter((t) => t.status === "completed").length;
        console.log(p + C.dim(`📋 计划 ${done}/${e.todos.length}：`));
        for (const t of e.todos) {
          const mark = t.status === "completed" ? C.green("[x]") : t.status === "in_progress" ? C.yellow("[~]") : C.dim("[ ]");
          console.log(p + "  " + mark + " " + (t.status === "completed" ? C.dim(t.content) : t.content));
        }
        break;
      }
      case "reminder":
        // 框架塞给模型的 system-reminder——和模型自己说的话区分开，标成暗紫提示。
        console.log(p + C.dim(`💉 注入提醒[${e.source}]：${oneLine(e.text)}`));
        break;
      case "compaction":
        console.log(p + C.dim(`🗜  压缩上下文：${e.before} → ${e.after} 条消息`));
        break;
      case "error":
        console.log(p + C.red("‼ " + e.message));
        break;
    }
  });
}

function oneLine(v: unknown): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  const flat = s.replace(/\s+/g, " ");
  return flat.length > 100 ? flat.slice(0, 100) + "…" : flat;
}
