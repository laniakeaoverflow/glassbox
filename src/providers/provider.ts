// Provider 接口：把"调一次大模型"抽象成统一形状。
// 两个实现 anthropic.ts / openai.ts 各自把内部格式翻成自家协议，再把响应翻回来。
import type { Message, Tool, LLMResult, StreamDelta } from "../types.js";
import type { Config, ProviderName } from "../config.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAIProvider } from "./openai.js";

export interface LLMProvider {
  name: string;
  model: string;
  /**
   * 调一次模型。systemPrompt 单独传——Anthropic 是顶层参数，
   * OpenAI 要塞成 system 消息，由各适配器处理，绝不混进 messages。
   *
   * onDelta 传了就走流式：边收边回调增量，最后仍返回同样形状的 LLMResult；
   * 不传则走非流式老路径（测试假 provider、关流场景）。
   */
  chat(
    systemPrompt: string,
    messages: Message[],
    tools: Tool[],
    onDelta?: (d: StreamDelta) => void
  ): Promise<LLMResult>;
}

/**
 * 构造一个 provider。override 可在运行时指定 provider/model（给 /model 命令用），
 * 不传则用 config 里的默认值。
 */
export function makeProvider(cfg: Config, override?: { provider?: ProviderName; model?: string }): LLMProvider {
  const name = override?.provider ?? cfg.provider;
  if (name === "anthropic") {
    if (!cfg.anthropic.apiKey) throw new Error("缺少 ANTHROPIC_API_KEY");
    return new AnthropicProvider(cfg.anthropic.apiKey, override?.model ?? cfg.anthropic.model);
  }
  if (name === "deepseek") {
    // DeepSeek 是 OpenAI 兼容协议，复用 OpenAIProvider，只是带上自己的 name/baseURL。
    if (!cfg.deepseek.apiKey) throw new Error("缺少 DEEPSEEK_API_KEY");
    return new OpenAIProvider(cfg.deepseek.apiKey, override?.model ?? cfg.deepseek.model, cfg.deepseek.baseURL, "deepseek");
  }
  if (!cfg.openai.apiKey) throw new Error("缺少 OPENAI_API_KEY");
  return new OpenAIProvider(cfg.openai.apiKey, override?.model ?? cfg.openai.model, cfg.openai.baseURL);
}
