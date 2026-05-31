// Anthropic Messages API 适配器。
// 我们的内部块格式几乎就是 Anthropic 原生格式，翻译最轻。
import Anthropic from "@anthropic-ai/sdk";
import type { Message, Tool, LLMResult } from "../types.js";
import type { LLMProvider } from "./provider.js";
import { maxOutput } from "./pricing.js";

export class AnthropicProvider implements LLMProvider {
  name = "anthropic";
  private client: Anthropic;
  constructor(apiKey: string, public model: string) {
    this.client = new Anthropic({ apiKey });
  }

  async chat(systemPrompt: string, messages: Message[], tools: Tool[]): Promise<LLMResult> {
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
    const res = await this.client.messages.create(request);

    // 响应翻回内部格式：text 块拼成文本，tool_use 块收成 toolCalls。
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
}
