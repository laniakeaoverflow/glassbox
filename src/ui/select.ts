// 一个无依赖的终端单选菜单。这正是 Claude Code 那个 /model 选择器的底层机制——
// 它用 Ink/React 包装，但原理就这三步：
//   1. setRawMode(true) 拿到逐键输入（不用等回车）
//   2. 解析方向键的 ANSI 转义码（↑="\x1b[A" ↓="\x1b[B"）
//   3. 每次按键后把光标移回菜单顶部，原地重绘、高亮当前项
import { stdin, stdout } from "node:process";

export interface SelectOption<T> {
  label: string;
  value: T;
  hint?: string; // 行尾灰字，如"当前"
}

// 把依赖的 stdin/stdout 抽成最小接口，方便单测时注入假流。
export interface KeyInput {
  isTTY?: boolean;
  setRawMode(b: boolean): void;
  resume(): void;
  on(ev: "data", fn: (b: Buffer) => void): void;
  removeListener(ev: "data", fn: (b: Buffer) => void): void;
}
export interface TextOutput {
  write(s: string): void;
}

/** 返回选中的 value；用户取消（Esc/Ctrl-C/q）或非 TTY 环境返回 null。 */
export function select<T>(
  title: string,
  options: SelectOption<T>[],
  startIndex = 0,
  io: { input?: KeyInput; output?: TextOutput } = {}
): Promise<T | null> {
  const input = io.input ?? (stdin as unknown as KeyInput);
  const output = io.output ?? stdout;
  // 非 TTY（如管道喂入）不支持 raw mode；返回 null 让调用方走文字回退。
  if (!input.isTTY || options.length === 0) return Promise.resolve(null);

  return new Promise((resolve) => {
    let idx = Math.max(0, Math.min(startIndex, options.length - 1));
    const lineCount = options.length + 2; // 标题 + 各选项 + 提示行
    let drawn = false;

    const draw = () => {
      if (drawn) output.write(`\x1b[${lineCount}A`); // 光标上移到菜单顶部
      output.write("\x1b[J"); // 清除从光标到屏幕末尾
      output.write(`\x1b[1m${title}\x1b[0m\n`);
      options.forEach((o, i) => {
        const on = i === idx;
        const marker = on ? "\x1b[36m▶ " : "  ";
        const hint = o.hint ? `  \x1b[2m${o.hint}` : "";
        output.write(`${marker}${o.label}${hint}\x1b[0m\n`);
      });
      output.write("\x1b[2m↑/↓ 选择 · Enter 确认 · Esc 取消\x1b[0m\n");
      drawn = true;
    };

    const finish = (value: T | null) => {
      if (drawn) output.write(`\x1b[${lineCount}A\x1b[J`); // 选完擦掉菜单，保持终端干净
      input.setRawMode(false);
      input.removeListener("data", onData);
      resolve(value);
    };

    const onData = (buf: Buffer) => {
      const k = buf.toString();
      if (k === "\x1b[A" || k === "k") {
        idx = (idx - 1 + options.length) % options.length;
        draw();
      } else if (k === "\x1b[B" || k === "j") {
        idx = (idx + 1) % options.length;
        draw();
      } else if (k === "\r" || k === "\n") {
        finish(options[idx].value);
      } else if (k === "\x1b" || k === "\x03" || k === "q") {
        finish(null); // Esc / Ctrl-C / q = 取消
      }
    };

    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
    draw();
  });
}
