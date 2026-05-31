// 静态价格 + 上下文窗口表。成本是估算用，窗口大小给面板算占用率。
// 单价单位：美元 / 百万 token。找不到的型号用兜底值。

interface ModelInfo {
  inPerM: number; // 输入每百万 token 价格
  outPerM: number; // 输出每百万 token 价格
  contextLimit: number; // 上下文窗口（token）
  maxOutput: number; // 单次最大输出 token（用作 max_tokens，取各模型官方/实测上限）
}

const TABLE: Record<string, ModelInfo> = {
  // Anthropic（maxOutput 为官方文档同步 Messages API 上限）
  "claude-sonnet-4-6": { inPerM: 3, outPerM: 15, contextLimit: 200_000, maxOutput: 64_000 },
  "claude-opus-4-8": { inPerM: 15, outPerM: 75, contextLimit: 200_000, maxOutput: 128_000 },
  "claude-haiku-4-5": { inPerM: 1, outPerM: 5, contextLimit: 200_000, maxOutput: 64_000 },
  // OpenAI
  "gpt-4o": { inPerM: 2.5, outPerM: 10, contextLimit: 128_000, maxOutput: 16_384 },
  "gpt-4o-mini": { inPerM: 0.15, outPerM: 0.6, contextLimit: 128_000, maxOutput: 16_384 },
  // DeepSeek（价格按官网人民币 ÷ 约 7.1 换算成美元，粗估用；maxOutput 为实测接口上限 393216）
  "deepseek-v4-flash": { inPerM: 0.14, outPerM: 0.28, contextLimit: 1_000_000, maxOutput: 393_216 },
  "deepseek-v4-pro": { inPerM: 0.42, outPerM: 0.85, contextLimit: 1_000_000, maxOutput: 393_216 },
  "deepseek-chat": { inPerM: 0.14, outPerM: 0.28, contextLimit: 1_000_000, maxOutput: 393_216 }, // legacy → v4-flash 非思考
  "deepseek-reasoner": { inPerM: 0.14, outPerM: 0.28, contextLimit: 1_000_000, maxOutput: 393_216 }, // legacy → v4-flash 思考
  // 其他第三方（OpenAI 兼容）
  "moonshot-v1-8k": { inPerM: 1.7, outPerM: 1.7, contextLimit: 8_000, maxOutput: 4_096 },
  "qwen-plus": { inPerM: 0.4, outPerM: 1.2, contextLimit: 131_072, maxOutput: 8_192 },
};

// 兜底：未知型号给个广泛安全的 8192（几乎所有模型都接受）。
const FALLBACK: ModelInfo = { inPerM: 1, outPerM: 3, contextLimit: 128_000, maxOutput: 8_192 };

/** 按型号前缀匹配，宽松一点（如 claude-sonnet-4-6-20250101 也能命中）。 */
function lookup(model: string): ModelInfo {
  if (TABLE[model]) return TABLE[model];
  const hit = Object.keys(TABLE).find((k) => model.startsWith(k));
  return hit ? TABLE[hit] : FALLBACK;
}

export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const m = lookup(model);
  return (inputTokens * m.inPerM + outputTokens * m.outPerM) / 1_000_000;
}

export function contextLimit(model: string): number {
  return lookup(model).contextLimit;
}

export function maxOutput(model: string): number {
  return lookup(model).maxOutput;
}
