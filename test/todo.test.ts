// TodoWrite 纯逻辑单测：校验 + 渲染。无需联网。
import test from "node:test";
import assert from "node:assert/strict";
import { parseTodos, formatTodos } from "../src/tools/todo.ts";

test("parseTodos：合法清单归一化通过", () => {
  const out = parseTodos([
    { content: " 写代码 ", status: "in_progress" },
    { content: "跑测试", status: "pending" },
  ]);
  assert.deepEqual(out, [
    { content: "写代码", status: "in_progress" }, // content 去空白
    { content: "跑测试", status: "pending" },
  ]);
});

test("parseTodos：非数组报错", () => {
  assert.throws(() => parseTodos("nope" as any), /数组/);
});

test("parseTodos：缺 content 报错", () => {
  assert.throws(() => parseTodos([{ status: "pending" }]), /缺少 content/);
});

test("parseTodos：非法 status 报错", () => {
  assert.throws(() => parseTodos([{ content: "x", status: "doing" }]), /status 非法/);
});

test("parseTodos：多于一项 in_progress 报错", () => {
  assert.throws(
    () => parseTodos([{ content: "a", status: "in_progress" }, { content: "b", status: "in_progress" }]),
    /最多只能有一项 in_progress/
  );
});

test("formatTodos：渲染勾选框，空清单有兜底", () => {
  assert.equal(formatTodos([]), "（空计划）");
  assert.equal(
    formatTodos([{ content: "a", status: "completed" }, { content: "b", status: "pending" }]),
    "[x] a\n[ ] b"
  );
});
