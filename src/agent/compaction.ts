// 上下文压缩（仿 Claude Code 的 auto-compaction）：
// 历史接近模型上下文窗口时，保留「最初的任务 + 最近几条」，把中间一大段用模型总结成一句进展摘要。
// 这样既不丢关键信息，又把 token 降下来，避免越跑越贵 / 撞上下文上限。
import type { Message } from "../types.js";
import type { LLMProvider } from "../providers/provider.js";

const KEEP_RECENT = 4; // 保留最近几条原样
const SUMMARIZE_SYSTEM =
  "你是对话压缩器。把给定的编码会话历史压成一段简洁的中文进展摘要，保留：已完成的步骤、读/写过的关键文件及要点、重要决定与结论、尚未完成的事。只输出摘要本身，不要寒暄。";

/** 上一次调用的输入 token 是否已超过窗口的某个比例。 */
export function shouldCompact(inputTokens: number, contextLimit: number, threshold: number): boolean {
  return contextLimit > 0 && inputTokens > contextLimit * threshold;
}

/** 把消息块拍平成可读文本（喂给摘要器，避免重放结构化的 tool_use/tool_result 引发配对问题）。 */
function transcript(messages: Message[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    for (const b of m.content) {
      if (b.type === "text" && b.text.trim()) lines.push(`${m.role}: ${b.text.trim()}`);
      else if (b.type === "tool_call") lines.push(`${m.role} 调用 ${b.name}(${JSON.stringify(b.input).slice(0, 300)})`);
      else if (b.type === "tool_result") lines.push(`工具结果: ${b.content.slice(0, 500)}`);
    }
  }
  return lines.join("\n");
}

export interface CompactResult {
  messages: Message[];
  before: number;
  after: number;
  usage: { inputTokens: number; outputTokens: number }; // 摘要调用本身的开销，要计入总账
}

const NO_USAGE = { inputTokens: 0, outputTokens: 0 };

/**
 * 压缩消息历史：保留 messages[0]（原始任务）+ 最近 KEEP_RECENT 条，把中间总结成一条。
 * 关键：recent 必须从一条 assistant 消息开始，保证 tool_use→tool_result 配对完整、不会让接口报 400。
 */
export async function compact(messages: Message[], provider: LLMProvider): Promise<CompactResult> {
  const before = messages.length;
  if (before <= KEEP_RECENT + 2) return { messages, before, after: before, usage: NO_USAGE };

  let cut = Math.max(1, before - KEEP_RECENT);
  while (cut > 1 && messages[cut].role !== "assistant") cut--; // 退到一条 assistant 开头
  const middle = messages.slice(1, cut);
  const recent = messages.slice(cut);
  if (middle.length === 0) return { messages, before, after: before, usage: NO_USAGE };

  const sum = await provider.chat(
    SUMMARIZE_SYSTEM,
    [{ role: "user", content: [{ type: "text", text: "压缩以下会话历史：\n\n" + transcript(middle) }] }],
    []
  );

  const taskText = messages[0].content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const compacted: Message[] = [
    { role: "user", content: [{ type: "text", text: `${taskText}\n\n【早前进展摘要】\n${sum.text}` }] },
    ...recent,
  ];
  return { messages: compacted, before, after: compacted.length, usage: sum.usage };
}
