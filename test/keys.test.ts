// 验证按键解码层：普通键、控制键、以及关键的 bracketed paste（含跨数据块）。
import test from "node:test";
import assert from "node:assert/strict";
import { createKeyDecoder, type Key } from "../src/ui/keys.ts";

const types = (ks: Key[]) => ks.map((k) => k.type);

test("可打印字符 → text", () => {
  const d = createKeyDecoder();
  assert.deepEqual(d("a"), [{ type: "text", text: "a" }]);
});

test("回车/退格/方向键/Option+Enter/Ctrl-C/D", () => {
  const d = createKeyDecoder();
  assert.deepEqual(types(d("\r")), ["enter"]);
  assert.deepEqual(types(d("\x7f")), ["backspace"]);
  assert.deepEqual(types(d("\x1b[C")), ["right"]);
  assert.deepEqual(types(d("\x1b[D")), ["left"]);
  assert.deepEqual(types(d("\x1b\r")), ["newline"]); // Option/Alt+Enter
  assert.deepEqual(types(d("\x03")), ["cancel"]);
  assert.deepEqual(types(d("\x04")), ["eof"]);
});

test("bracketed paste（单块）→ 整段作为一次 text，换行保留", () => {
  const d = createKeyDecoder();
  const ks = d("\x1b[200~You are a dev.\nBuild a game.\x1b[201~");
  assert.deepEqual(ks, [{ type: "text", text: "You are a dev.\nBuild a game." }]);
});

test("bracketed paste（跨数据块）→ 累积成一次 text", () => {
  const d = createKeyDecoder();
  assert.deepEqual(d("\x1b[200~hel"), []); // 还没结束，先不产出
  assert.deepEqual(d("lo\nwor"), []);
  assert.deepEqual(d("ld\x1b[201~"), [{ type: "text", text: "hello\nworld" }]);
});

test("粘贴结束后同块里还有普通输入", () => {
  const d = createKeyDecoder();
  const ks = d("\x1b[200~x\x1b[201~y");
  assert.deepEqual(ks, [
    { type: "text", text: "x" },
    { type: "text", text: "y" },
  ]);
});

test("中文/多字节按码点切分", () => {
  const d = createKeyDecoder();
  assert.deepEqual(d("你好"), [
    { type: "text", text: "你" },
    { type: "text", text: "好" },
  ]);
});
