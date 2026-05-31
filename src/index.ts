#!/usr/bin/env node
// CLI 入口：把所有组件装配起来，跑一个终端 REPL。
//   你输入 → runLoop（主 agent）→ 工具/子 agent → 事件总线 → 终端 + 面板
import { stdin } from "node:process";
import { loadConfig, type Config, type ProviderName } from "./config.js";
import { makeProvider, type LLMProvider } from "./providers/provider.js";
import { systemPrompt } from "./agent/system-prompt.js";
import { buildTools } from "./tools/registry.js";
import { runLoop } from "./agent/loop.js";
import { startPrinter } from "./ui/printer.js";
import { select, type SelectOption } from "./ui/select.js";
import { createInput, type Input } from "./ui/input.js";
import { startDashboard } from "./dashboard/server.js";
import { replaySession } from "./replay.js";
import { loadMemory, memorySources } from "./memory.js";
import { startSessionLog } from "./logging/session-log.js";
import { killAllBackground } from "./tools/shells.js";

async function main() {
  const cfg = loadConfig();

  // 回放模式：glassbox --replay <session.jsonl> —— 不需要 key、不跑 agent，
  // 只把一份录像重放到面板，用来无门槛体验"看 agent 工作"。
  const replayIdx = process.argv.indexOf("--replay");
  if (replayIdx !== -1) {
    const file = process.argv[replayIdx + 1];
    if (!file) {
      console.error("用法: glassbox --replay <session.jsonl>");
      process.exit(1);
    }
    startPrinter();
    startDashboard(cfg.dashboardPort);
    console.log(`\x1b[1mglassbox\x1b[0m \x1b[2m回放模式\x1b[0m`);
    console.log(`\x1b[2m面板: http://127.0.0.1:${cfg.dashboardPort}  ·  录像: ${file}\x1b[0m\n`);
    console.log(`\x1b[2m（先打开面板，3 秒后开始回放…）\x1b[0m`);
    await new Promise((r) => setTimeout(r, 3000)); // 留时间打开浏览器
    const n = await replaySession(file);
    console.log(`\x1b[2m回放完成（${n} 个事件）。面板保持开启，Ctrl+C 退出。\x1b[0m`);
    return; // dashboard 服务保持进程存活
  }

  // 可变：/model 命令运行时切换。task 工具和 runLoop 都通过 getter/闭包读它。
  let activeProvider = makeProvider(cfg);
  // 系统提示 = 基础提示 + 记忆（GLASSBOX.md / 历史会话学到的经验），跨会话保留。
  const sysPrompt = systemPrompt(process.cwd()) + loadMemory(process.cwd());
  const autoApprove = process.env.AUTO_APPROVE === "1";

  // 自己掌管的输入层（raw-mode 行编辑器 + bracketed paste；非 TTY 退化为按行读取）。
  // 空闲时丢弃输入，所以权限询问不会被粘贴/提前输入误答；多行粘贴会被当成一条任务。
  const input = createInput();

  // 危险操作的确认回调（v1：仅终端）。
  const confirm = async (req: { name: string; args: Record<string, unknown> }) => {
    if (autoApprove) return true;
    const ans = await input.readLine(`\x1b[33m允许执行 ${req.name}? \x1b[2m${JSON.stringify(req.args).slice(0, 120)}\x1b[0m (y/N) `);
    return (ans ?? "").trim().toLowerCase() === "y";
  };

  const tools = buildTools({
    getProvider: () => activeProvider,
    systemPrompt: sysPrompt,
    maxTurns: cfg.maxTurns,
    maxDepth: cfg.maxDepth,
    confirm,
  });

  startPrinter();
  startDashboard(cfg.dashboardPort);
  // 本次会话日志（每启动一次单独一份）
  const sessionLog = startSessionLog({ provider: activeProvider.name, model: activeProvider.model, cwd: process.cwd() });

  console.log(`\x1b[1mglassbox\x1b[0m  provider=\x1b[36m${activeProvider.name}/${activeProvider.model}\x1b[0m`);
  console.log(`\x1b[2m面板: http://127.0.0.1:${cfg.dashboardPort}  ·  /model 切换模型 · /memory 看记忆 · /exit 退出\x1b[0m`);
  console.log(`\x1b[2m本次日志: ${sessionLog.logPath}\x1b[0m`);
  if (loadMemory(process.cwd())) console.log(`\x1b[2m已加载记忆（/memory 查看）\x1b[0m`);
  console.log();

  let n = 0;
  while (true) {
    const line = await input.readLine("\x1b[32m›\x1b[0m ");
    if (line === null) break; // EOF（如管道喂完）/ Ctrl+C 空行
    const text = line.trim();
    if (!text) continue;
    if (text === "/exit" || text === "/quit") break;
    if (text === "/model" || text.startsWith("/model ")) {
      activeProvider = await handleModelCommand(text, cfg, activeProvider, input);
      continue;
    }
    if (text === "/memory") {
      console.log("\x1b[2m记忆来源（全局 / 项目 / agent 自记）：\x1b[0m");
      for (const f of memorySources(process.cwd())) console.log("  " + f);
      const mem = loadMemory(process.cwd());
      console.log(mem ? `\x1b[2m--- 已加载内容 ---\x1b[0m${mem}` : "\x1b[2m（暂无记忆。用 remember 工具或写 GLASSBOX.md 来添加）\x1b[0m");
      continue;
    }

    await runLoop({
      task: text,
      agentId: `main-${++n}`,
      depth: 0,
      provider: activeProvider,
      tools,
      systemPrompt: sysPrompt,
      maxTurns: cfg.maxTurns,
      compactThreshold: cfg.compactThreshold,
      confirm,
    });
    console.log();
  }

  killAllBackground(); // 会话级清理：回收所有还在跑的后台进程，避免泄漏
  console.log(`\x1b[2m日志已保存: ${sessionLog.logPath}\x1b[0m`);
  await sessionLog.close(); // 等日志 flush 完再退出，别丢掉最后几条
  input.close();
  process.exit(0);
}

type ModelChoice = { provider: ProviderName; model?: string };

/** 该 provider 在 .env 里配的预设模型。 */
function presetModel(cfg: Config, p: ProviderName): string {
  return p === "anthropic" ? cfg.anthropic.model : p === "deepseek" ? cfg.deepseek.model : cfg.openai.model;
}

/** 构造交互菜单的选项：三家预设 + 几个常用备选模型。 */
function modelMenu(cfg: Config): SelectOption<ModelChoice>[] {
  return [
    { label: `anthropic · ${cfg.anthropic.model}`, value: { provider: "anthropic" } },
    { label: `anthropic · claude-opus-4-8`, value: { provider: "anthropic", model: "claude-opus-4-8" } },
    { label: `deepseek · ${cfg.deepseek.model}`, value: { provider: "deepseek" } },
    { label: `deepseek · deepseek-reasoner`, value: { provider: "deepseek", model: "deepseek-reasoner" } },
    { label: `openai · ${cfg.openai.model}`, value: { provider: "openai" } },
  ];
}

/**
 * 处理 /model 命令，返回切换后的 provider（失败或取消时返回原来的）。
 *   /model                              交互菜单（方向键选）；非 TTY 则打印预设
 *   /model <anthropic|openai|deepseek>  切到该 provider 的预设（用 .env 里配的模型）
 *   /model <model>                      当前 provider 换个模型，如 /model claude-opus-4-8
 *   /model <provider> <model>           切 provider 并指定模型，如 /model deepseek deepseek-reasoner
 */
async function handleModelCommand(
  cmd: string,
  cfg: Config,
  current: LLMProvider,
  io: Input
): Promise<LLMProvider> {
  const parts = cmd.trim().split(/\s+/).slice(1);
  const isProvider = (s: string): s is ProviderName => s === "anthropic" || s === "openai" || s === "deepseek";
  const apply = (choice: ModelChoice): LLMProvider => {
    try {
      const next = makeProvider(cfg, choice);
      console.log(`\x1b[36m已切换到 ${next.name}/${next.model}\x1b[0m`);
      return next;
    } catch (e) {
      console.log(`\x1b[31m切换失败：${(e as Error).message}\x1b[0m`);
      return current;
    }
  };

  // 无参数：TTY 弹方向键菜单，非 TTY（管道/脚本）打印预设。
  if (parts.length === 0) {
    if (stdin.isTTY) {
      const opts = modelMenu(cfg);
      // 标出当前项并作为初始高亮位置
      opts.forEach((o) => {
        if (o.value.provider === current.name && (o.value.model ?? presetModel(cfg, o.value.provider)) === current.model)
          o.hint = "当前";
      });
      const start = Math.max(0, opts.findIndex((o) => o.hint === "当前"));
      io.pause(); // 让出 stdin 给 raw-mode 菜单
      const choice = await select("选择 provider / 模型：", opts, start);
      io.resume();
      if (!choice) {
        console.log("\x1b[2m（已取消）\x1b[0m");
        return current;
      }
      return apply(choice);
    }
    console.log(`当前：\x1b[36m${current.name}/${current.model}\x1b[0m`);
    console.log(
      `\x1b[2m已配置预设：anthropic/${cfg.anthropic.model} · openai/${cfg.openai.model}` +
        `${cfg.openai.baseURL ? ` (${cfg.openai.baseURL})` : ""} · deepseek/${cfg.deepseek.model}\x1b[0m`
    );
    console.log("\x1b[2m用法：/model <anthropic|openai|deepseek> · /model <model> · /model <provider> <model>\x1b[0m");
    return current;
  }

  let providerName: ProviderName;
  let model: string | undefined; // undefined = 用该 provider 在 .env 里的预设模型
  if (parts.length === 1) {
    if (isProvider(parts[0])) {
      providerName = parts[0]; // 只给 provider 名 → 切到它的预设
    } else {
      providerName = current.name as ProviderName; // 否则视为换当前 provider 的模型
      model = parts[0];
    }
  } else {
    if (!isProvider(parts[0])) {
      console.log(`\x1b[31m未知 provider：${parts[0]}（只支持 anthropic / openai / deepseek）\x1b[0m`);
      return current;
    }
    providerName = parts[0];
    model = parts.slice(1).join(" ");
  }

  return apply({ provider: providerName, model });
}

main().catch((e) => {
  console.error("\x1b[31m启动失败：\x1b[0m", e.message);
  process.exit(1);
});
