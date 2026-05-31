// 验证编辑状态 reducer：插入/换行/提交/续行/退格/光标移动/取消/EOF。
import test from "node:test";
import assert from "node:assert/strict";
import { initState, applyKey, type EditorState } from "../src/ui/editor-core.ts";
import type { Key } from "../src/ui/keys.ts";

// 依次应用一串按键
const run = (keys: Key[], start: EditorState = initState()) => keys.reduce(applyKey, start);

test("插入文本，光标右移", () => {
  const s = run([{ type: "text", text: "hi" }]);
  assert.equal(s.buffer, "hi");
  assert.equal(s.cursor, 2);
});

test("粘贴文本里的 \\r\\n 归一成 \\n", () => {
  const s = run([{ type: "text", text: "a\r\nb\rc" }]);
  assert.equal(s.buffer, "a\nb\nc");
});

test("Enter 提交", () => {
  const s = run([{ type: "text", text: "go" }, { type: "enter" }]);
  assert.equal(s.status, "submit");
  assert.equal(s.buffer, "go");
});

test("Option+Enter 插入换行而不提交", () => {
  const s = run([{ type: "text", text: "a" }, { type: "newline" }, { type: "text", text: "b" }]);
  assert.equal(s.buffer, "a\nb");
  assert.equal(s.status, "editing");
});

test("行尾反斜杠 + Enter = 换行（去掉反斜杠，不提交）", () => {
  const s = run([{ type: "text", text: "a\\" }, { type: "enter" }, { type: "text", text: "b" }]);
  assert.equal(s.buffer, "a\nb");
  assert.equal(s.status, "editing");
});

test("退格删除光标前字符", () => {
  const s = run([{ type: "text", text: "abc" }, { type: "left" }, { type: "backspace" }]);
  assert.equal(s.buffer, "ac");
  assert.equal(s.cursor, 1);
});

test("home/end 在当前行内移动", () => {
  let s = run([{ type: "text", text: "hello\nworld" }]); // cursor 在末尾
  s = applyKey(s, { type: "home" });
  assert.equal(s.cursor, 6); // "world" 行首
  s = applyKey(s, { type: "end" });
  assert.equal(s.cursor, 11); // "world" 行尾
});

test("Ctrl+C：有内容则清空，空行则取消", () => {
  const cleared = run([{ type: "text", text: "abc" }, { type: "cancel" }]);
  assert.equal(cleared.buffer, "");
  assert.equal(cleared.status, "editing");
  const canceled = run([{ type: "cancel" }]);
  assert.equal(canceled.status, "cancel");
});

test("Ctrl+D：仅空行时 EOF", () => {
  assert.equal(run([{ type: "eof" }]).status, "eof");
  assert.equal(run([{ type: "text", text: "x" }, { type: "eof" }]).status, "editing");
});
