// 单测 OpenAI 流式累积纯逻辑：把一串 chunk 折叠成 text + 工具调用 + 用量，
// 并在过程中吐出正确的 StreamDelta。无需联网。
import test from "node:test";
import assert from "node:assert/strict";
import { accumulateOpenAIStream, type OpenAIStreamChunk } from "../src/providers/openai.ts";
import type { StreamDelta } from "../src/types.ts";

// 模拟一次「先说一句话，再调一个工具」的流式响应：
//  - 文本分两片
//  - 工具调用首片带 index+id+name（arguments 空），随后 arguments 跨多片拼接
//  - 末尾一片带 finish_reason，最后一片带 usage
const chunks: OpenAIStreamChunk[] = [
  { choices: [{ delta: { content: "你好" } }] },
  { choices: [{ delta: { content: "，我来调用" } }] },
  { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "echo", arguments: "" } }] } }] },
  { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"msg":' } }] } }] },
  { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"hi"}' } }] } }] },
  { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
  { choices: [], usage: { prompt_tokens: 12, completion_tokens: 7 } },
];

test("accumulateOpenAIStream：装配 text / 工具调用 / 用量", () => {
  const state = accumulateOpenAIStream(chunks);
  assert.equal(state.text, "你好，我来调用");
  assert.equal(state.toolCalls.length, 1);
  assert.deepEqual(state.toolCalls[0], { id: "call_1", name: "echo", arguments: '{"msg":"hi"}' });
  assert.equal(state.finishReason, "tool_calls");
  assert.deepEqual(state.usage, { inputTokens: 12, outputTokens: 7 });
});

test("accumulateOpenAIStream：onDelta 吐出 text / tool_start / tool_input", () => {
  const deltas: StreamDelta[] = [];
  accumulateOpenAIStream(chunks, (d) => deltas.push(d));

  const texts = deltas.filter((d) => d.kind === "text");
  assert.equal(texts.map((d) => (d as any).text).join(""), "你好，我来调用");

  const starts = deltas.filter((d) => d.kind === "tool_start");
  assert.equal(starts.length, 1, "工具调用只宣告一次 tool_start");
  assert.deepEqual({ id: (starts[0] as any).toolId, name: (starts[0] as any).toolName }, { id: "call_1", name: "echo" });

  const inputs = deltas.filter((d) => d.kind === "tool_input");
  assert.equal(inputs.map((d) => (d as any).partialJson).join(""), '{"msg":"hi"}');
});
