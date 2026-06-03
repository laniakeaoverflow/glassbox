// Anthropic Messages API 适配器。
// 我们的内部块格式几乎就是 Anthropic 原生格式，翻译最轻。
import Anthropic from "@anthropic-ai/sdk";
import type { Message, Tool, LLMResult, StreamDelta } from "../types.js";
import type { LLMProvider } from "./provider.js";
import { maxOutput } from "./pricing.js";

export class AnthropicProvider implements LLMProvider {
  name = "anthropic";
  private client: Anthropic;
  constructor(apiKey: string, public model: string) {
    this.client = new Anthropic({ apiKey });
  }

  async chat(
    systemPrompt: string,
    messages: Message[],
    tools: Tool[],
    onDelta?: (d: StreamDelta) => void
  ): Promise<LLMResult> {
    // 内部 Message -> Anthropic 消息：content 块逐个翻译。
    const apiMessages = messages.map((m) => ({
      role: m.role,
      content: m.content.map((b) => {
        if (b.type === "text") return { type: "text" as const, text: b.text };
        if (b.type === "tool_call")
          return { type: "tool_use" as const, id: b.id, name: b.name, input: b.input };
        // tool_result：Anthropic 放在 user 消息里，键是 tool_use_id
        return {
          type: "tool_result" as const,
          tool_use_id: b.id,
          content: b.content,
          is_error: b.isError,
        };
      }),
    }));

    const request = {
      model: this.model,
      max_tokens: maxOutput(this.model), // 取该模型官方输出上限
      system: systemPrompt, // 顶层参数，不进 messages
      messages: apiMessages as Anthropic.MessageParam[],
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters as Anthropic.Tool.InputSchema,
      })),
    };
    // 流式：边收边回调增量，结束后用 finalMessage() 拿到拼好的完整 Message，再走同一套翻译。
    const res = onDelta
      ? await this.streamMessage(request, onDelta)
      : await this.client.messages.create(request);

    return toResult(res, request);
  }

  /** 流式调用：转发增量给 onDelta，返回 SDK 拼好的最终 Message（形状同非流式响应）。 */
  private async streamMessage(
    request: Anthropic.MessageCreateParamsNonStreaming,
    onDelta: (d: StreamDelta) => void
  ): Promise<Anthropic.Message> {
    const stream = this.client.messages.stream(request);
    for await (const ev of stream) {
      if (ev.type === "content_block_start" && ev.content_block.type === "tool_use") {
        onDelta({ kind: "tool_start", toolIndex: ev.index, toolId: ev.content_block.id, toolName: ev.content_block.name });
      } else if (ev.type === "content_block_delta") {
        if (ev.delta.type === "text_delta") onDelta({ kind: "text", text: ev.delta.text });
        else if (ev.delta.type === "input_json_delta")
          onDelta({ kind: "tool_input", toolIndex: ev.index, partialJson: ev.delta.partial_json });
      }
    }
    return stream.finalMessage();
  }
}

/** 把 Anthropic 响应（流式拼好的 / 非流式的，形状一致）翻回内部 LLMResult。 */
function toResult(res: Anthropic.Message, request: unknown): LLMResult {
  let text = "";
  const toolCalls: LLMResult["toolCalls"] = [];
  for (const block of res.content) {
    if (block.type === "text") text += block.text;
    else if (block.type === "tool_use")
      toolCalls.push({ id: block.id, name: block.name, input: block.input as Record<string, unknown> });
  }
  return {
    text,
    toolCalls,
    usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens },
    stopReason: res.stop_reason ?? "",
    raw: res,
    rawRequest: request,
  };
}
