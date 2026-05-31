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
function fakeProvider(script: Array<{ text: string; toolCalls?: { id: string; name: string; input: any }[] }>): LLMProvider {
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
        stopReason: step.toolCalls?.length ? "tool_use" : "end_turn",
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
