// 验证上下文压缩：阈值判断 + 把中间历史总结成一条、保留任务与最近几条、配对不破。
import test from "node:test";
import assert from "node:assert/strict";
import { shouldCompact, compact } from "../src/agent/compaction.ts";
import type { LLMProvider } from "../src/providers/provider.ts";
import type { Message } from "../src/types.ts";

const fakeSummarizer: LLMProvider = {
  name: "fake",
  model: "fake",
  async chat() {
    return { text: "【摘要】之前读写了若干文件。", toolCalls: [], usage: { inputTokens: 5, outputTokens: 5 }, stopReason: "stop", raw: {}, rawRequest: {} };
  },
};

test("shouldCompact：超过阈值才触发", () => {
  assert.equal(shouldCompact(80, 100, 0.7), true);
  assert.equal(shouldCompact(60, 100, 0.7), false);
  assert.equal(shouldCompact(100, 0, 0.7), false); // 窗口未知不触发
});

// 造一段较长的历史：task + 若干 (assistant tool_call / user tool_result) 轮
function longHistory(turns: number): Message[] {
  const msgs: Message[] = [{ role: "user", content: [{ type: "text", text: "原始任务" }] }];
  for (let i = 0; i < turns; i++) {
    msgs.push({ role: "assistant", content: [{ type: "tool_call", id: `t${i}`, name: "read_file", input: { path: `f${i}` } }] });
    msgs.push({ role: "user", content: [{ type: "tool_result", id: `t${i}`, content: `文件${i}内容` }] });
  }
  return msgs;
}

test("compact：中间被总结，保留任务与最近几条，且 recent 从 assistant 开始", async () => {
  const msgs = longHistory(8); // 1 + 16 = 17 条
  const r = await compact(msgs, fakeSummarizer);

  assert.ok(r.after < r.before, "压缩后消息数应减少");
  // 第一条是 user，含原始任务 + 摘要
  assert.equal(r.messages[0].role, "user");
  const first = r.messages[0].content.map((b) => (b.type === "text" ? b.text : "")).join("");
  assert.match(first, /原始任务/);
  assert.match(first, /早前进展摘要/);
  assert.match(first, /摘要/);
  // 紧跟的 recent 必须从 assistant 开始（保证 tool_use→tool_result 配对完整）
  assert.equal(r.messages[1].role, "assistant");
});

test("compact：太短则原样返回", async () => {
  const msgs = longHistory(1); // 3 条，太短
  const r = await compact(msgs, fakeSummarizer);
  assert.equal(r.after, r.before);
});
