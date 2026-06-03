// 用一个假的 provider 跑核心循环——不碰网络，验证：
//  1. 工具调用被执行，结果回灌
//  2. 多轮后能正常收尾
//  3. 事件总线发出了预期事件
//  4. 危险工具会走权限确认
import test from "node:test";
import assert from "node:assert/strict";
import { runLoop } from "../src/agent/loop.ts";
import { bus } from "../src/events/bus.ts";
import type { LLMProvider } from "../src/providers/provider.ts";
import type { Tool, StreamDelta } from "../src/types.ts";

/** 脚本化的假 provider：按预设依次返回。可选 deltas：调用时透传给 onDelta（模拟流式）。 */
function fakeProvider(
  script: Array<{ text: string; toolCalls?: { id: string; name: string; input: any }[]; stopReason?: string; deltas?: StreamDelta[] }>
): LLMProvider {
  let i = 0;
  return {
    name: "fake",
    model: "fake-model",
    async chat(_sys, _msgs, _tools, onDelta) {
      const step = script[Math.min(i++, script.length - 1)];
      if (onDelta && step.deltas) for (const d of step.deltas) onDelta(d);
      return {
        text: step.text,
        toolCalls: step.toolCalls ?? [],
        usage: { inputTokens: 10, outputTokens: 5 },
        stopReason: step.stopReason ?? (step.toolCalls?.length ? "tool_use" : "end_turn"),
        raw: { fake: true },
        rawRequest: { fake: true },
      };
    },
  };
}

const echoTool: Tool = {
  name: "echo",
  description: "回显",
  parameters: { type: "object", properties: { msg: { type: "string" } } },
  async execute(input) {
    return `echo:${input.msg}`;
  },
};

const dangerTool: Tool = {
  name: "danger",
  description: "危险",
  dangerous: true,
  parameters: { type: "object", properties: {} },
  async execute() {
    return "executed";
  },
};

test("循环执行工具调用并把结果回灌，最后收尾", async () => {
  const events: string[] = [];
  const off = bus.on((e) => events.push(e.type));

  const provider = fakeProvider([
    { text: "我来回显一下", toolCalls: [{ id: "t1", name: "echo", input: { msg: "你好" } }] },
    { text: "回显完成：你好" }, // 第二轮没有工具调用 = 收尾
  ]);

  const result = await runLoop({
    task: "回显你好",
    agentId: "test-1",
    depth: 0,
    provider,
    tools: [echoTool],
    systemPrompt: "test",
    maxTurns: 10,
    confirm: async () => true,
  });

  off();
  assert.equal(result.ok, true);
  assert.equal(result.finalText, "回显完成：你好");
  assert.equal(result.totalOutputTokens, 10); // 两轮各 5
  assert.ok(events.includes("tool_start"));
  assert.ok(events.includes("tool_result"));
  assert.ok(events.includes("conversation_end"));
});

test("危险工具被拒绝时不执行，返回拒绝信息", async () => {
  const provider = fakeProvider([
    { text: "", toolCalls: [{ id: "d1", name: "danger", input: {} }] },
    { text: "好的，不执行了" },
  ]);

  let askedPermission = false;
  const result = await runLoop({
    task: "做危险操作",
    agentId: "test-2",
    depth: 0,
    provider,
    tools: [dangerTool],
    systemPrompt: "test",
    maxTurns: 10,
    confirm: async () => {
      askedPermission = true;
      return false; // 拒绝
    },
  });

  assert.equal(askedPermission, true);
  assert.equal(result.ok, true);
});

test("maxTurns 护栏：工具死循环会被截断", async () => {
  // 永远返回同一个工具调用，制造死循环
  const provider = fakeProvider([{ text: "循环", toolCalls: [{ id: "x", name: "echo", input: { msg: "x" } }] }]);

  const result = await runLoop({
    task: "死循环",
    agentId: "test-3",
    depth: 0,
    provider,
    tools: [echoTool],
    systemPrompt: "test",
    maxTurns: 3,
    confirm: async () => true,
  });

  assert.equal(result.ok, false); // 达到 maxTurns
});

// 一个带必填参数、并记录是否被执行的工具
function writerTool(flag: { executed: boolean }): Tool {
  return {
    name: "writer",
    description: "写文件",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    async execute() {
      flag.executed = true;
      return "wrote";
    },
  };
}

test("Fix A 参数校验：缺必填参数则报错、不执行（防 undefined 垃圾文件）", async () => {
  const flag = { executed: false };
  const provider = fakeProvider([
    { text: "", toolCalls: [{ id: "w1", name: "writer", input: {} }] }, // 空参数（模拟截断退化成 {}）
    { text: "收到报错，改一下" },
  ]);
  const result = await runLoop({
    task: "写", agentId: "fa", depth: 0, provider, tools: [writerTool(flag)],
    systemPrompt: "t", maxTurns: 10, confirm: async () => true,
  });
  assert.equal(flag.executed, false, "缺必填参数不应执行");
  assert.equal(result.ok, true);
});

test("流式：deltas 透传成 llm_delta 事件，最终结果与非流式一致", async () => {
  const events: any[] = [];
  const off = bus.on((e) => events.push(e));
  const provider = fakeProvider([
    {
      text: "你好世界",
      deltas: [
        { kind: "text", text: "你好" },
        { kind: "text", text: "世界" },
      ],
    },
  ]);
  const result = await runLoop({
    task: "打个招呼", agentId: "stream-1", depth: 0, provider, tools: [],
    systemPrompt: "t", maxTurns: 10, confirm: async () => true, // stream 默认开
  });
  off();
  const deltas = events.filter((e) => e.type === "llm_delta");
  assert.equal(deltas.length, 2, "应发出 2 个 llm_delta");
  assert.equal(deltas.map((d) => d.text).join(""), "你好世界");
  assert.equal(result.finalText, "你好世界", "最终结果不受流式影响");
});

test("流式关闭（stream:false）时不发 llm_delta", async () => {
  const events: string[] = [];
  const off = bus.on((e) => events.push(e.type));
  const provider = fakeProvider([{ text: "无流", deltas: [{ kind: "text", text: "无流" }] }]);
  await runLoop({
    task: "x", agentId: "nostream-1", depth: 0, provider, tools: [],
    systemPrompt: "t", maxTurns: 10, confirm: async () => true, stream: false,
  });
  off();
  assert.ok(!events.includes("llm_delta"), "关流时不应发 llm_delta");
});

test("注入：initialReminders 在第 1 轮被拼进首条 user 消息，并发 reminder 事件", async () => {
  const seen: any[] = [];
  const events: any[] = [];
  const off = bus.on((e) => events.push(e));
  const provider: LLMProvider = {
    name: "fake", model: "fake-model",
    async chat(_sys, msgs) {
      seen.push(JSON.parse(JSON.stringify(msgs)));
      return { text: "好的", toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, stopReason: "end_turn", raw: {}, rawRequest: {} };
    },
  };
  await runLoop({
    task: "干活", agentId: "rem-1", depth: 0, provider, tools: [],
    systemPrompt: "t", maxTurns: 5, confirm: async () => true, stream: false,
    initialReminders: [{ source: "env", text: "ENV-CTX" }],
  });
  off();
  const firstMsgText = JSON.stringify(seen[0][0]); // 第 1 轮的首条 user 消息
  assert.ok(firstMsgText.includes("ENV-CTX"), "启动提醒应注入首条 user 消息");
  assert.ok(firstMsgText.includes("<system-reminder>"), "应包成 system-reminder 块");
  const rem = events.filter((e) => e.type === "reminder");
  assert.equal(rem.length, 1);
  assert.deepEqual({ source: rem[0].source, text: rem[0].text }, { source: "env", text: "ENV-CTX" });
});

test("注入：工具 ctx.remind 的内容在下一轮出现在发给模型的消息里", async () => {
  const seen: any[] = [];
  const provider: LLMProvider = {
    name: "fake", model: "fake-model",
    async chat(_sys, msgs) {
      seen.push(JSON.parse(JSON.stringify(msgs)));
      // 第 1 轮调用一个会 remind 的工具；第 2 轮收尾
      if (seen.length === 1)
        return { text: "", toolCalls: [{ id: "t1", name: "remtool", input: {} }], usage: { inputTokens: 1, outputTokens: 1 }, stopReason: "tool_use", raw: {}, rawRequest: {} };
      return { text: "完成", toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, stopReason: "end_turn", raw: {}, rawRequest: {} };
    },
  };
  const remtool: Tool = {
    name: "remtool", description: "会注入提醒", parameters: { type: "object", properties: {} },
    async execute(_i, ctx) { ctx.remind?.("todo", "HELLO-REMINDER"); return "ok"; },
  };
  await runLoop({
    task: "x", agentId: "rem-2", depth: 0, provider, tools: [remtool],
    systemPrompt: "t", maxTurns: 5, confirm: async () => true, stream: false,
  });
  const turn2 = JSON.stringify(seen[1]); // 第 2 轮发给模型的消息
  assert.ok(turn2.includes("HELLO-REMINDER"), "tool 注入的提醒应出现在下一轮消息里");
  assert.ok(turn2.includes("<system-reminder>"));
});

test("Fix B 截断检测：stopReason=length 时不执行残缺工具调用，回灌提示", async () => {
  const flag = { executed: false };
  const events: string[] = [];
  const off = bus.on((e) => events.push(e.type));
  const provider = fakeProvider([
    // 参数其实是齐的，但 stopReason=length 表示被截断 → 仍不应执行
    { text: "我来写", toolCalls: [{ id: "t1", name: "writer", input: { path: "x" } }], stopReason: "length" },
    { text: "改短重来：写好了" },
  ]);
  const result = await runLoop({
    task: "写大文件", agentId: "fb", depth: 0, provider, tools: [writerTool(flag)],
    systemPrompt: "t", maxTurns: 10, confirm: async () => true,
  });
  off();
  assert.equal(flag.executed, false, "被截断的工具调用不应执行");
  assert.ok(events.includes("error"), "应发出截断 error 事件");
  assert.equal(result.finalText, "改短重来：写好了");
});
