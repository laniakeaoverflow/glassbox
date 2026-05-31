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
  return bus.on((e: AgentEvent) => {
    const p = indent(e);
    switch (e.type) {
      case "conversation_start":
        if (e.parentAgentId) console.log(p + C.dim(`↳ 子 agent 启动：${e.task.slice(0, 60)}`));
        break;
      case "llm_response":
        if (e.text.trim()) console.log(p + C.cyan("◆ ") + e.text.trim());
        console.log(p + C.dim(`  ${e.provider}/${e.model} · ${e.latencyMs}ms · in ${e.inputTokens} out ${e.outputTokens} tok · $${e.costUsd.toFixed(5)} · ${e.stopReason}`));
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
