// 从环境变量读取配置，决定用哪个 provider。
import dotenv from "dotenv";
import os from "node:os";
import path from "node:path";

// 密钥加载顺序（先加载者优先；已存在的 shell 环境变量始终最高）：
//   1) 当前目录的 .env —— 项目内开发，或针对某个工程覆盖
//   2) 全局 ~/.glassbox/.env —— 全局安装后从任意文件夹运行时的密钥来源
// 这样 `mcc` 在别的文件夹里跑时，工具操作的是那个文件夹，但密钥从全局配置读。
dotenv.config();
dotenv.config({ path: path.join(os.homedir(), ".glassbox", ".env") });

/** 全局配置文件路径，供 README / 报错提示引用。 */
export const GLOBAL_ENV_PATH = path.join(os.homedir(), ".glassbox", ".env");

// DeepSeek 是 OpenAI 兼容协议，所以下面复用 OpenAIProvider，只是单列成一个 provider。
export type ProviderName = "anthropic" | "openai" | "deepseek";

/** OpenAI 兼容的 provider 配置（openai 和 deepseek 共用这个形状）。 */
export interface OpenAICompatConfig {
  apiKey: string;
  baseURL?: string;
  model: string;
}

export interface Config {
  provider: ProviderName;
  anthropic: { apiKey: string; model: string };
  openai: OpenAICompatConfig;
  deepseek: OpenAICompatConfig;
  dashboardPort: number;
  maxTurns: number; // 每个 loop 最多几轮，防工具死循环
  maxDepth: number; // 子 agent 最多嵌套几层，防套娃
}

export function loadConfig(): Config {
  const provider = (process.env.PROVIDER ?? "anthropic") as ProviderName;
  return {
    provider,
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY ?? "",
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
    },
    openai: {
      apiKey: process.env.OPENAI_API_KEY ?? "",
      baseURL: process.env.OPENAI_BASE_URL || undefined,
      model: process.env.OPENAI_MODEL ?? "gpt-4o",
    },
    deepseek: {
      apiKey: process.env.DEEPSEEK_API_KEY ?? "",
      baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
      model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
    },
    dashboardPort: Number(process.env.DASHBOARD_PORT ?? 4100),
    maxTurns: Number(process.env.MAX_TURNS ?? 20),
    maxDepth: Number(process.env.MAX_DEPTH ?? 2),
  };
}
