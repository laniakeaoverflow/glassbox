// 用一个假键盘流测交互选择器的核心逻辑：方向键移动 + 回车确认 + Esc 取消。
// （真终端的 raw mode 没法在 CI 里跑，但按键解析逻辑可以这样验证。）
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { select, type KeyInput, type TextOutput } from "../src/ui/select.ts";

/** 假 stdin：isTTY=true，记录 raw mode 是否被还原，可手动 emit 按键。 */
function fakeKeyboard() {
  const ee = new EventEmitter();
  let rawOn = false;
  const input: KeyInput = {
    isTTY: true,
    setRawMode: (b) => { rawOn = b; },
    resume: () => {},
    on: (ev, fn) => { ee.on(ev, fn); },
    removeListener: (ev, fn) => { ee.removeListener(ev, fn); },
  };
  return { input, press: (s: string) => ee.emit("data", Buffer.from(s)), rawOn: () => rawOn };
}

const sink: TextOutput = { write: () => {} }; // 吞掉菜单输出
const OPTS = [
  { label: "a", value: "A" },
  { label: "b", value: "B" },
  { label: "c", value: "C" },
];

const DOWN = "\x1b[B", UP = "\x1b[A", ENTER = "\r", ESC = "\x1b";

test("方向键下移两次 + 回车 → 选中第三项", async () => {
  const kb = fakeKeyboard();
  const p = select("t", OPTS, 0, { input: kb.input, output: sink });
  kb.press(DOWN);
  kb.press(DOWN);
  kb.press(ENTER);
  assert.equal(await p, "C");
  assert.equal(kb.rawOn(), false); // raw mode 已还原
});

test("上移会绕回到末项", async () => {
  const kb = fakeKeyboard();
  const p = select("t", OPTS, 0, { input: kb.input, output: sink });
  kb.press(UP); // 0 -> 绕到 2
  kb.press(ENTER);
  assert.equal(await p, "C");
});

test("Esc 取消返回 null", async () => {
  const kb = fakeKeyboard();
  const p = select("t", OPTS, 1, { input: kb.input, output: sink });
  kb.press(ESC);
  assert.equal(await p, null);
});

test("非 TTY 直接返回 null（走文字回退）", async () => {
  const kb = fakeKeyboard();
  kb.input.isTTY = false;
  assert.equal(await select("t", OPTS, 0, { input: kb.input, output: sink }), null);
});
