// OpenAI 兼容 chat completions 适配器。配 baseURL 即可接 DeepSeek/Kimi/通义/OpenRouter。
// 与 Anthropic 的差异都在这里抹平：
//  - system 是一条消息，不是顶层参数
//  - 助手的 tool_calls 在顶层；工具结果是独立的 role:"tool" 消息（不嵌在 user 里）
//  - 工具参数 arguments 是 JSON 字符串，不是对象
import OpenAI from "openai";
import type { Message, Tool, LLMResult } from "../types.js";
import type { LLMProvider } from "./provider.js";
import { maxOutput } from "./pricing.js";

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  // name 可定制：DeepSeek 等兼容服务复用这个类，但在面板/日志里显示自己的名字。
  constructor(apiKey: string, public model: string, baseURL?: string, public name = "openai") {
    this.client = new OpenAI({ apiKey, baseURL });
  }

  async chat(systemPrompt: string, messages: Message[], tools: Tool[]): Promise<LLMResult> {
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
        // user 消息：文本块拼成一条 user，工具结果各自成一条 role:"tool"
        const texts = m.content.filter((b) => b.type === "text") as Extract<(typeof m.content)[number], { type: "text" }>[];
        if (texts.length) apiMessages.push({ role: "user", content: texts.map((t) => t.text).join("\n") });
        for (const b of m.content) {
          if (b.type === "tool_result")
            apiMessages.push({ role: "tool", tool_call_id: b.id, content: b.content });
        }
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
}

function safeParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s || "{}");
  } catch {
    return {};
  }
}
