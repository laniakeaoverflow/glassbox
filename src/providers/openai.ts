// OpenAI 兼容 chat completions 适配器。配 baseURL 即可接 DeepSeek/Kimi/通义/OpenRouter。
// 与 Anthropic 的差异都在这里抹平：
//  - system 是一条消息，不是顶层参数
//  - 助手的 tool_calls 在顶层；工具结果是独立的 role:"tool" 消息（不嵌在 user 里）
//  - 工具参数 arguments 是 JSON 字符串，不是对象
import OpenAI from "openai";
import type { Message, Tool, LLMResult, StreamDelta } from "../types.js";
import type { LLMProvider } from "./provider.js";
import { maxOutput } from "./pricing.js";

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  // name 可定制：DeepSeek 等兼容服务复用这个类，但在面板/日志里显示自己的名字。
  constructor(apiKey: string, public model: string, baseURL?: string, public name = "openai") {
    this.client = new OpenAI({ apiKey, baseURL });
  }

  async chat(
    systemPrompt: string,
    messages: Message[],
    tools: Tool[],
    onDelta?: (d: StreamDelta) => void
  ): Promise<LLMResult> {
    const apiMessages: OpenAI.ChatCompletionMessageParam[] = [{ role: "system", content: systemPrompt }];

    // 把内部块格式"摊平"成 OpenAI 的消息序列。
    for (const m of messages) {
      if (m.role === "assistant") {
        const text = m.content.filter((b) => b.type === "text").map((b) => (b as any).text).join("");
        const calls = m.content.filter((b) => b.type === "tool_call") as Extract<
          (typeof m.content)[number],
          { type: "tool_call" }
        >[];
        apiMessages.push({
          role: "assistant",
          content: text || null,
          ...(calls.length
            ? {
                tool_calls: calls.map((c) => ({
                  id: c.id,
                  type: "function" as const,
                  function: { name: c.name, arguments: JSON.stringify(c.input) },
                })),
              }
            : {}),
        });
      } else {
        // user 消息：工具结果各自成一条 role:"tool"，文本块拼成一条 user。
        // ⚠️ 顺序：tool 必须紧跟在带 tool_calls 的 assistant 后面，所以 tool 先推、user 文本后推
        //（否则当一条 user 消息里同时有 tool_result 和注入的 reminder 文本时，OpenAI 会报错）。
        for (const b of m.content) {
          if (b.type === "tool_result")
            apiMessages.push({ role: "tool", tool_call_id: b.id, content: b.content });
        }
        const texts = m.content.filter((b) => b.type === "text") as Extract<(typeof m.content)[number], { type: "text" }>[];
        if (texts.length) apiMessages.push({ role: "user", content: texts.map((t) => t.text).join("\n") });
      }
    }

    const request = {
      model: this.model,
      max_tokens: maxOutput(this.model), // 取该模型实测/官方输出上限（不设的话只有默认 8192）
      messages: apiMessages,
      tools: tools.length
        ? tools.map((t) => ({
            type: "function" as const,
            function: { name: t.name, description: t.description, parameters: t.parameters },
          }))
        : undefined,
    };
    if (onDelta) return this.chatStream(request, onDelta);

    const res = await this.client.chat.completions.create(request);

    const choice = res.choices[0];
    const toolCalls: LLMResult["toolCalls"] = (choice.message.tool_calls ?? [])
      .filter((c) => c.type === "function")
      .map((c) => ({
        id: c.id,
        name: c.function.name,
        input: safeParse(c.function.arguments), // arguments 是字符串，解析回对象
      }));

    return {
      text: choice.message.content ?? "",
      toolCalls,
      usage: {
        inputTokens: res.usage?.prompt_tokens ?? 0,
        outputTokens: res.usage?.completion_tokens ?? 0,
      },
      stopReason: choice.finish_reason ?? "",
      raw: res,
      rawRequest: request,
    };
  }

  /** 流式调用：遍历 chunk，转发增量给 onDelta，同时累积出最终结果。 */
  private async chatStream(
    request: OpenAI.ChatCompletionCreateParamsNonStreaming,
    onDelta: (d: StreamDelta) => void
  ): Promise<LLMResult> {
    // include_usage：让最后一个 chunk 带上 token 用量（DeepSeek 支持；不支持的兼容服务回退 0）。
    const stream = await this.client.chat.completions.create({
      ...request,
      stream: true,
      stream_options: { include_usage: true },
    });
    const state = newStreamState();
    for await (const chunk of stream) reduceChunk(state, chunk, onDelta);
    return finishStream(state, request);
  }
}

function safeParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s || "{}");
  } catch {
    return {};
  }
}

// ===== 流式累积（纯逻辑，可单测） =====

/** 一个工具调用在流式过程中的累积态：id/name 来自首个 chunk，arguments 跨多个 chunk 拼接。 */
interface ToolAcc {
  id: string;
  name: string;
  arguments: string;
}
export interface StreamState {
  text: string;
  toolCalls: ToolAcc[]; // 按 chunk 里的 index 定位
  finishReason: string;
  usage: { inputTokens: number; outputTokens: number };
}

/** chunk 里我们关心的最小形状（真实 SDK chunk 是其超集，结构兼容）。 */
export interface OpenAIStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

export function newStreamState(): StreamState {
  return { text: "", toolCalls: [], finishReason: "", usage: { inputTokens: 0, outputTokens: 0 } };
}

/** 把单个 chunk 折进累积态；onDelta 可选，用于实时转发增量。 */
export function reduceChunk(state: StreamState, chunk: OpenAIStreamChunk, onDelta?: (d: StreamDelta) => void): void {
  const choice = chunk.choices?.[0];
  if (choice) {
    const d = choice.delta ?? {};
    if (d.content) {
      state.text += d.content;
      onDelta?.({ kind: "text", text: d.content });
    }
    for (const tc of d.tool_calls ?? []) {
      const i = tc.index ?? 0;
      const isNew = !state.toolCalls[i];
      const slot = (state.toolCalls[i] ??= { id: "", name: "", arguments: "" });
      if (tc.id) slot.id = tc.id;
      if (tc.function?.name) slot.name = tc.function.name;
      // 工具调用的首个 chunk 带 id+name（arguments 可能为空）→ 宣告一次 tool_start
      if (isNew) onDelta?.({ kind: "tool_start", toolIndex: i, toolId: slot.id, toolName: slot.name });
      if (tc.function?.arguments) {
        slot.arguments += tc.function.arguments;
        onDelta?.({ kind: "tool_input", toolIndex: i, partialJson: tc.function.arguments });
      }
    }
    if (choice.finish_reason) state.finishReason = choice.finish_reason;
  }
  if (chunk.usage)
    state.usage = { inputTokens: chunk.usage.prompt_tokens ?? 0, outputTokens: chunk.usage.completion_tokens ?? 0 };
}

/** 折叠一串 chunk → 累积态。给测试用（实时路径用 reduceChunk 逐个折）。 */
export function accumulateOpenAIStream(chunks: OpenAIStreamChunk[], onDelta?: (d: StreamDelta) => void): StreamState {
  const state = newStreamState();
  for (const c of chunks) reduceChunk(state, c, onDelta);
  return state;
}

/** 累积态 → 内部 LLMResult。raw 重建成非流式响应的形状，让面板的「原始响应/输出工具」继续可用。 */
function finishStream(state: StreamState, request: unknown): LLMResult {
  const present = state.toolCalls.filter(Boolean);
  const raw = {
    choices: [
      {
        message: {
          content: state.text || null,
          ...(present.length
            ? {
                tool_calls: present.map((c) => ({
                  id: c.id,
                  type: "function" as const,
                  function: { name: c.name, arguments: c.arguments },
                })),
              }
            : {}),
        },
        finish_reason: state.finishReason,
      },
    ],
    usage: { prompt_tokens: state.usage.inputTokens, completion_tokens: state.usage.outputTokens },
  };
  return {
    text: state.text,
    toolCalls: present.map((c) => ({ id: c.id, name: c.name, input: safeParse(c.arguments) })),
    usage: state.usage,
    stopReason: state.finishReason,
    raw,
    rawRequest: request,
  };
}
