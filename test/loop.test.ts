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
import type { Tool } from "../src/types.ts";

/** 脚本化的假 provider：按预设依次返回。 */
function fakeProvider(
  script: Array<{ text: string; toolCalls?: { id: string; name: string; input: any }[]; stopReason?: string }>
): LLMProvider {
  let i = 0;
  return {
    name: "fake",
    model: "fake-model",
    async chat() {
      const step = script[Math.min(i++, script.length - 1)];
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
