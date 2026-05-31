// 编辑状态：纯函数 (state, key) → state。不碰终端、不渲染，所以可以放心单测。
// 这是行编辑器的"大脑"：决定每个按键如何改变缓冲区和光标，以及何时算"提交"。
import type { Key } from "./keys.js";

export interface EditorState {
  buffer: string; // 当前内容（可含 \n，即多行）
  cursor: number; // 光标在 buffer 中的下标
  status: "editing" | "submit" | "cancel" | "eof";
}

export const initState = (): EditorState => ({ buffer: "", cursor: 0, status: "editing" });

export function applyKey(s: EditorState, k: Key): EditorState {
  const b = s.buffer;
  const c = s.cursor;

  switch (k.type) {
    case "text": {
      // 粘贴/输入的文本里把 \r\n、\r 统一成 \n
      const text = k.text.replace(/\r\n?/g, "\n");
      return { ...s, buffer: b.slice(0, c) + text + b.slice(c), cursor: c + text.length };
    }
    case "newline":
      return { ...s, buffer: b.slice(0, c) + "\n" + b.slice(c), cursor: c + 1 };

    case "enter":
      // 续行符：当前行（光标前）以反斜杠结尾，则把 \ 换成换行，而非提交
      if (b.slice(0, c).endsWith("\\")) {
        return { ...s, buffer: b.slice(0, c - 1) + "\n" + b.slice(c), cursor: c };
      }
      return { ...s, status: "submit" };

    case "backspace":
      if (c === 0) return s;
      return { ...s, buffer: b.slice(0, c - 1) + b.slice(c), cursor: c - 1 };
    case "delete":
      if (c >= b.length) return s;
      return { ...s, buffer: b.slice(0, c) + b.slice(c + 1), cursor: c };

    case "left":
      return c > 0 ? { ...s, cursor: c - 1 } : s;
    case "right":
      return c < b.length ? { ...s, cursor: c + 1 } : s;
    case "home": {
      const nl = b.lastIndexOf("\n", c - 1); // 当前行行首
      return { ...s, cursor: nl + 1 };
    }
    case "end": {
      const nl = b.indexOf("\n", c); // 当前行行尾
      return { ...s, cursor: nl === -1 ? b.length : nl };
    }

    case "cancel":
      // Ctrl+C：有内容则清空当前行；空行则取消（退出）
      return b.length > 0 ? { buffer: "", cursor: 0, status: "editing" } : { ...s, status: "cancel" };
    case "eof":
      // Ctrl+D：仅在空行时表示 EOF
      return b.length === 0 ? { ...s, status: "eof" } : s;
  }
}
