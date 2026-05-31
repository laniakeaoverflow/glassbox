// 输入层（仿 Claude Code）：自己掌管终端输入，不用 readline 的"一换行一提交"。
//  - TTY：持久 raw 模式 + 开启 bracketed paste，逐键解码 → 编辑 → 重绘。
//    粘贴的多行被识别成"一次输入"，Enter 才提交，Option+Enter / 行尾反斜杠插入换行。
//    空闲时（两次输入之间）丢弃输入，所以权限询问绝不会被提前/粘贴的内容误答。
//  - 非 TTY（管道/脚本）：退化为按行读取，便于 `printf '...' | mcc`。
import { stdin, stdout } from "node:process";
import readline from "node:readline";
import { createKeyDecoder, type Key } from "./keys.js";
import { initState, applyKey, type EditorState } from "./editor-core.js";

export interface Input {
  readLine(prompt: string): Promise<string | null>; // 返回提交内容；null = EOF/取消
  pause(): void; // 让出 stdin（给 raw-mode 选择器用）
  resume(): void;
  close(): void;
}

export function createInput(): Input {
  return stdin.isTTY ? ttyInput() : pipeInput();
}

// ============ 显示宽度（中文/全角按 2 列）============
function charWidth(cp: number): number {
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  )
    return 2;
  return 1;
}
const dispWidth = (s: string) => {
  let w = 0;
  for (const ch of s) w += charWidth(ch.codePointAt(0)!);
  return w;
};
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

// ============ TTY：raw-mode 行编辑器 ============
function ttyInput(): Input {
  const decode = createKeyDecoder();
  let active: ((keys: Key[]) => void) | null = null; // 当前在读输入的处理器；null=空闲(丢弃)

  const onData = (chunk: Buffer) => {
    const keys = decode(chunk);
    if (active) active(keys);
    // 空闲时丢弃：避免把"提前敲/粘贴残留"的输入误当成下一次的答复
  };

  const enable = () => {
    stdin.setRawMode(true);
    stdout.write("\x1b[?2004h"); // 开启 bracketed paste
    stdin.resume();
    stdin.on("data", onData);
  };
  const disable = () => {
    stdin.off("data", onData);
    stdout.write("\x1b[?2004l"); // 关闭 bracketed paste
    try {
      stdin.setRawMode(false);
    } catch {
      /* 可能已分离 */
    }
  };
  enable();

  const readLine = (prompt: string): Promise<string | null> =>
    new Promise((resolve) => {
      let state = initState();
      const promptW = dispWidth(stripAnsi(prompt));
      let lastCursorRow = 0;
      let first = true;

      const render = () => {
        if (!first) {
          if (lastCursorRow > 0) stdout.write(`\x1b[${lastCursorRow}A`);
          stdout.write("\r");
        }
        stdout.write("\x1b[J"); // 清除从光标到屏幕末尾
        stdout.write(prompt + state.buffer);

        // 目标光标位置（行、列）
        const before = state.buffer.slice(0, state.cursor).split("\n");
        const cursorRow = before.length - 1;
        const cursorCol = (cursorRow === 0 ? promptW : 0) + dispWidth(before[cursorRow]);
        // 打印后光标停在内容末尾
        const all = state.buffer.split("\n");
        const endRow = all.length - 1;

        if (endRow - cursorRow > 0) stdout.write(`\x1b[${endRow - cursorRow}A`);
        stdout.write("\r");
        if (cursorCol > 0) stdout.write(`\x1b[${cursorCol}C`);
        lastCursorRow = cursorRow;
        first = false;
      };

      const finish = (value: string | null) => {
        // 把光标挪到内容末尾再换行，保证后续输出从新行开始
        state = { ...state, cursor: state.buffer.length };
        render();
        stdout.write("\n");
        active = null;
        resolve(value);
      };

      active = (keys) => {
        for (const k of keys) {
          state = applyKey(state, k);
          if (state.status === "submit") return finish(state.buffer);
          if (state.status === "cancel" || state.status === "eof") return finish(null);
        }
        render();
      };

      render();
    });

  return {
    readLine,
    pause: disable,
    resume: enable,
    close: disable,
  };
}

// ============ 非 TTY：按行读取（管道/脚本）============
function pipeInput(): Input {
  const rl = readline.createInterface({ input: stdin });
  const queue: string[] = [];
  let waiter: ((l: string | null) => void) | null = null;
  let closed = false;
  rl.on("line", (l) => {
    if (waiter) {
      const w = waiter;
      waiter = null;
      w(l);
    } else queue.push(l);
  });
  rl.on("close", () => {
    closed = true;
    if (waiter) {
      const w = waiter;
      waiter = null;
      w(null);
    }
  });
  return {
    readLine(prompt) {
      stdout.write(prompt);
      if (queue.length) return Promise.resolve(queue.shift()!);
      if (closed) return Promise.resolve(null);
      return new Promise((res) => (waiter = res));
    },
    pause() {},
    resume() {},
    close() {
      rl.close();
    },
  };
}
