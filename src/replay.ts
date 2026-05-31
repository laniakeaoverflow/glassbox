// 回放：读取一份 .jsonl 会话录像，把事件按节奏重放到事件总线——
// 面板和终端会像实时运行一样显示出来。不需要 API key，是"无门槛试玩"的关键。
import { promises as fs } from "node:fs";
import { bus } from "./events/bus.js";
import type { AgentEvent } from "./events/types.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 把录像里的事件逐条重放到总线。返回重放的事件数。 */
export async function replaySession(path: string, delayMs = 200): Promise<number> {
  const text = await fs.readFile(path, "utf8");
  const lines = text.split("\n").filter((l) => l.trim());
  let n = 0;
  for (const line of lines) {
    let e: { type?: string };
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (!e || typeof e.type !== "string" || e.type === "session_start") continue; // 跳过头部元信息
    bus.replay(e as AgentEvent);
    n++;
    await sleep(delayMs);
  }
  return n;
}
