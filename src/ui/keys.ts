// 按键解码层：把终端 raw 模式下的原始字节流，解析成一个个"按键事件"。
// 这是自己掌管输入的第一步——不靠 readline 的"一换行一提交"，而是逐键理解用户意图。
// 关键：支持 bracketed paste（终端给粘贴内容包上 \x1b[200~ … \x1b[201~ 标记），
// 这样一整段多行粘贴会被识别成"一次粘贴"，里面的换行只是文字、不触发提交。

export type Key =
  | { type: "text"; text: string } // 可打印字符 / 一整段粘贴
  | { type: "enter" } // 提交
  | { type: "newline" } // 插入换行（Option/Alt+Enter）
  | { type: "backspace" }
  | { type: "delete" }
  | { type: "left" }
  | { type: "right" }
  | { type: "home" }
  | { type: "end" }
  | { type: "cancel" } // Ctrl+C
  | { type: "eof" }; // Ctrl+D

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

/** 创建一个有状态的解码器（粘贴可能跨多个数据块到达，需要累积）。 */
export function createKeyDecoder() {
  let pasting = false;
  let pasteBuf = "";

  return function decode(chunk: Buffer | string): Key[] {
    let s = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    const keys: Key[] = [];

    while (s.length > 0) {
      // —— 粘贴进行中：一直累积到结束标记 ——
      if (pasting) {
        const end = s.indexOf(PASTE_END);
        if (end === -1) {
          pasteBuf += s;
          s = "";
        } else {
          pasteBuf += s.slice(0, end);
          keys.push({ type: "text", text: pasteBuf }); // 整段粘贴作为一次文本插入
          pasteBuf = "";
          pasting = false;
          s = s.slice(end + PASTE_END.length);
        }
        continue;
      }
      if (s.startsWith(PASTE_START)) {
        pasting = true;
        s = s.slice(PASTE_START.length);
        continue;
      }

      // —— 转义序列 ——
      if (s.startsWith("\x1b[C")) { keys.push({ type: "right" }); s = s.slice(3); continue; }
      if (s.startsWith("\x1b[D")) { keys.push({ type: "left" }); s = s.slice(3); continue; }
      if (s.startsWith("\x1b[H") || s.startsWith("\x1b[1~")) { keys.push({ type: "home" }); s = s.slice(s.startsWith("\x1b[H") ? 3 : 4); continue; }
      if (s.startsWith("\x1b[F") || s.startsWith("\x1b[4~")) { keys.push({ type: "end" }); s = s.slice(s.startsWith("\x1b[F") ? 3 : 4); continue; }
      if (s.startsWith("\x1b[3~")) { keys.push({ type: "delete" }); s = s.slice(4); continue; }
      if (s.startsWith("\x1b\r") || s.startsWith("\x1b\n")) { keys.push({ type: "newline" }); s = s.slice(2); continue; } // Option/Alt+Enter

      // —— 单个控制字符 ——
      const c = s[0];
      if (c === "\r" || c === "\n") { keys.push({ type: "enter" }); s = s.slice(1); continue; }
      if (c === "\x7f" || c === "\x08") { keys.push({ type: "backspace" }); s = s.slice(1); continue; }
      if (c === "\x03") { keys.push({ type: "cancel" }); s = s.slice(1); continue; } // Ctrl+C
      if (c === "\x04") { keys.push({ type: "eof" }); s = s.slice(1); continue; } // Ctrl+D
      if (c === "\x01") { keys.push({ type: "home" }); s = s.slice(1); continue; } // Ctrl+A
      if (c === "\x05") { keys.push({ type: "end" }); s = s.slice(1); continue; } // Ctrl+E
      if (c === "\x1b") { s = s.slice(1); continue; } // 未识别的转义，跳过 ESC
      if (c < " ") { s = s.slice(1); continue; } // 其它控制字符忽略

      // —— 可打印字符（按码点取，兼容 emoji/中文等多字节）——
      const ch = String.fromCodePoint(s.codePointAt(0)!);
      keys.push({ type: "text", text: ch });
      s = s.slice(ch.length);
    }

    return keys;
  };
}
