// 极简的类型化事件总线。给事件补上自增 id 和时间戳，再广播给所有订阅者。
import { EventEmitter } from "node:events";
import type { AgentEvent } from "./types.js";

/** 发事件时不用自己填的字段。用分配式 Omit，否则联合类型会被压扁成公共字段。 */
type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;
type Raw = DistributiveOmit<AgentEvent, "id" | "ts">;

class Bus {
  private emitter = new EventEmitter();
  private seq = 0;
  private nowMs: () => number;

  constructor() {
    // Date.now 在本进程里随便用；抽出来只是方便测试。
    this.nowMs = () => Date.now();
    this.emitter.setMaxListeners(50);
  }

  emit(e: Raw): AgentEvent {
    const full = { ...e, id: ++this.seq, ts: this.nowMs() } as AgentEvent;
    this.emitter.emit("event", full);
    return full;
  }

  on(fn: (e: AgentEvent) => void): () => void {
    this.emitter.on("event", fn);
    return () => this.emitter.off("event", fn);
  }
}

/** 全局单例——CLI、loop、面板共用同一条总线。 */
export const bus = new Bus();
