// ★核心★ agent 循环。主 agent 和子 agent 共用这一个函数——
// "子 agent 就是同一个循环再跑一遍"，只是换了 agentId 和聚焦的任务。
import type { Message, Tool, ContentBlock } from "../types.js";
import type { LLMProvider } from "../providers/provider.js";
import { costUsd, contextLimit } from "../providers/pricing.js";
import { bus } from "../events/bus.js";

export interface LoopOptions {
  task: string;
  agentId: string;
  parentAgentId?: string;
  depth: number;
  provider: LLMProvider;
  tools: Tool[];
  systemPrompt: string;
  maxTurns: number;
  /** 危险工具的确认回调。返回 false 则拒绝执行。 */
  confirm: (req: { name: string; args: Record<string, unknown> }) => Promise<boolean>;
}

export interface LoopResult {
  ok: boolean;
  finalText: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
}

export async function runLoop(opts: LoopOptions): Promise<LoopResult> {
  const { task, agentId, parentAgentId, provider, tools, systemPrompt, maxTurns, confirm } = opts;
  const byName = new Map(tools.map((t) => [t.name, t]));

  let totalIn = 0,
    totalOut = 0,
    totalCost = 0;
  let finalText = "";
  let ok = true;

  const env = () => ({ agentId, parentAgentId, turn });
  let turn = 0;

  bus.emit({ type: "conversation_start", provider: provider.name, model: provider.model, task, ...env() });

  const messages: Message[] = [{ role: "user", content: [{ type: "text", text: task }] }];

  try {
    for (turn = 1; turn <= maxTurns; turn++) {
      bus.emit({ type: "llm_request", provider: provider.name, model: provider.model, messageCount: messages.length, ...env() });

      const t0 = Date.now();
      const res = await provider.chat(systemPrompt, messages, tools);
      const latencyMs = Date.now() - t0;

      totalIn += res.usage.inputTokens;
      totalOut += res.usage.outputTokens;
      const cost = costUsd(provider.model, res.usage.inputTokens, res.usage.outputTokens);
      totalCost += cost;

      bus.emit({
        type: "llm_response",
        provider: provider.name,
        model: provider.model,
        latencyMs,
        inputTokens: res.usage.inputTokens,
        outputTokens: res.usage.outputTokens,
        costUsd: cost,
        contextLimit: contextLimit(provider.model),
        stopReason: res.stopReason,
        text: res.text,
        raw: res.raw,
        rawRequest: res.rawRequest,
        ...env(),
      });

      // 把助手这一轮拼成内部消息：先文本块，再工具调用块。
      const assistantBlocks: ContentBlock[] = [];
      if (res.text) assistantBlocks.push({ type: "text", text: res.text });
      for (const c of res.toolCalls) assistantBlocks.push({ type: "tool_call", id: c.id, name: c.name, input: c.input });
      messages.push({ role: "assistant", content: assistantBlocks });

      // 截断检测：回复因超出输出上限被切断 → 工具调用很可能不完整（参数 JSON 残缺 → 解析成 {}）。
      // 不执行那些残缺调用，回灌提示让模型缩短/分块重来。否则会写出 undefined 垃圾文件还谎报成功。
      if (res.stopReason === "length" || res.stopReason === "max_tokens") {
        const notice =
          "（上一条回复因超出输出上限被截断，工具调用不完整、未执行。请缩短单次输出，或把大文件分多次写：先 write_file 写开头，再用 edit_file 追加补全。）";
        bus.emit({ type: "error", where: "truncation", message: "模型输出被截断(max_tokens)，已提示分块重试", ...env() });
        // 协议要求每个 tool_use 都要配一个 tool_result；没有工具调用就回一条普通提示。
        messages.push({
          role: "user",
          content: res.toolCalls.length
            ? res.toolCalls.map((c): ContentBlock => ({ type: "tool_result", id: c.id, content: notice, isError: true }))
            : [{ type: "text", text: notice }],
        });
        continue;
      }

      // 没有工具调用 = 收尾。
      if (res.toolCalls.length === 0) {
        finalText = res.text;
        break;
      }

      // 执行所有工具调用，结果回灌（每个 tool_call 必须有配对结果，出错也要回）。
      const resultBlocks: ContentBlock[] = [];
      for (const call of res.toolCalls) {
        resultBlocks.push(await runTool(call, byName, { agentId, depth: opts.depth }, confirm, env));
      }
      messages.push({ role: "user", content: resultBlocks });
    }

    if (turn > maxTurns) {
      ok = false;
      finalText = finalText || `（达到最大轮数 ${maxTurns}，已停止）`;
    }
  } catch (e) {
    ok = false;
    finalText = `出错：${(e as Error).message}`;
    bus.emit({ type: "error", where: "loop", message: (e as Error).message, ...env() });
  }

  bus.emit({ type: "conversation_end", ok, totalInputTokens: totalIn, totalOutputTokens: totalOut, totalCostUsd: totalCost, ...env() });
  return { ok, finalText, totalInputTokens: totalIn, totalOutputTokens: totalOut, totalCostUsd: totalCost };
}

/** 执行单个工具调用：权限确认 → 跑 → 发事件 → 返回内部 tool_result 块。 */
async function runTool(
  call: { id: string; name: string; input: Record<string, unknown> },
  byName: Map<string, Tool>,
  ctx: { agentId: string; depth: number },
  confirm: LoopOptions["confirm"],
  env: () => { agentId: string; parentAgentId?: string; turn: number }
): Promise<ContentBlock> {
  bus.emit({ type: "tool_start", toolCallId: call.id, name: call.name, args: call.input, ...env() });
  const tool = byName.get(call.name);

  const fail = (msg: string, durationMs = 0): ContentBlock => {
    bus.emit({ type: "tool_result", toolCallId: call.id, name: call.name, ok: false, resultPreview: msg, result: msg, durationMs, ...env() });
    return { type: "tool_result", id: call.id, content: msg, isError: true };
  };

  if (!tool) return fail(`未知工具：${call.name}`);

  // 参数校验：缺必填参数就报清晰错误、不执行。
  // 这是截断的安全网——参数被解析成 {} 时不会再写出 undefined 垃圾文件，而是让模型收到明确报错去纠正。
  const required = (tool.parameters?.required as string[] | undefined) ?? [];
  const missing = required.filter((k) => call.input[k] === undefined || call.input[k] === "");
  if (missing.length) return fail(`缺少必填参数：${missing.join(", ")}（若上一步回复被截断，请缩短或分块重写）`);

  if (tool.dangerous) {
    bus.emit({ type: "permission_request", toolCallId: call.id, name: call.name, args: call.input, ...env() });
    const approved = await confirm({ name: call.name, args: call.input });
    bus.emit({ type: "permission_resolved", toolCallId: call.id, approved, ...env() });
    if (!approved) return fail("用户拒绝了该操作。");
  }

  // 计时只覆盖真正的执行，不含上面等待用户批准的时间。
  const t0 = Date.now();
  try {
    const out = await tool.execute(call.input, ctx);
    bus.emit({ type: "tool_result", toolCallId: call.id, name: call.name, ok: true, resultPreview: preview(out), result: out, durationMs: Date.now() - t0, ...env() });
    return { type: "tool_result", id: call.id, content: out };
  } catch (e) {
    return fail(`工具执行失败：${(e as Error).message}`, Date.now() - t0);
  }
}

function preview(s: string): string {
  return s.length > 300 ? s.slice(0, 300) + " …" : s;
}
