// 全项目共享的核心类型。无依赖，防止循环引用。
// 这里是 provider 归一化的关键：不管底层是 Anthropic 还是 OpenAI，
// 对话历史一律用下面这套内部格式表示。

/** 一条消息里的内容块。Anthropic 原生就是块数组；OpenAI 我们在适配器里拼出来。 */
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; id: string; content: string; isError?: boolean };

export interface Message {
  role: "user" | "assistant";
  content: ContentBlock[];
}

/** 一次 LLM 调用归一化后的结果。 */
export interface LLMResult {
  text: string; // 助手这一轮说的话（可能为空）
  toolCalls: { id: string; name: string; input: Record<string, unknown> }[];
  usage: { inputTokens: number; outputTokens: number };
  stopReason: string; // 归一化后的停止原因，仅供展示
  raw: unknown; // 未加工的原始响应——面板上"看原始 JSON"用
  rawRequest: unknown; // 发给模型的原始请求体（含完整消息历史，不含 key）——日志/对比用
}

/** 一个工具的定义。execute 返回给模型看的字符串结果。 */
export interface Tool {
  name: string;
  description: string;
  /** JSON Schema（object 类型），描述参数。两家 provider 都吃这个。 */
  parameters: Record<string, unknown>;
  /** 是否危险操作，需要权限确认（如写文件、跑命令）。 */
  dangerous?: boolean;
  execute: (input: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
}

/** 工具执行时拿到的上下文（用于子 agent 递归调用 loop）。 */
export interface ToolContext {
  agentId: string;
  depth: number;
}
