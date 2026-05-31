// task 工具：派生一个子 agent 处理子任务。
// 它就是把 runLoop 再调一次（depth+1、新 agentId），结果回灌给父 agent。
// 这正是"多 agent 协作"的全部秘密——没有第二套循环。
import type { Tool } from "../types.js";
import { runLoop } from "../agent/loop.js";
import type { LoopOptions } from "../agent/loop.js";
import { bus } from "../events/bus.js";

let counter = 0;

export interface TaskDeps {
  /** 用 getter 拿 provider，好让 /model 切换后派生的子 agent 也跟着用新模型。 */
  getProvider: () => LoopOptions["provider"];
  /** 用 getter 拿工具列表，好让子 agent 也能拿到 task 工具本身。 */
  getTools: () => Tool[];
  systemPrompt: string;
  maxTurns: number;
  maxDepth: number;
  confirm: LoopOptions["confirm"];
}

export function makeTaskTool(deps: TaskDeps): Tool {
  return {
    name: "task",
    description: "派生一个子 agent 去独立完成一个聚焦的子任务，返回它的总结。适合可拆分的工作。",
    parameters: {
      type: "object",
      properties: {
        description: { type: "string", description: "交给子 agent 的完整任务描述" },
      },
      required: ["description"],
    },
    async execute(input, ctx) {
      if (ctx.depth >= deps.maxDepth) {
        return `已达最大嵌套深度 ${deps.maxDepth}，不能再派生子 agent，请自己完成。`;
      }
      const task = String(input.description);
      const childAgentId = `${ctx.agentId}.${++counter}`;

      bus.emit({ type: "subagent_spawn", childAgentId, task, agentId: ctx.agentId, turn: 0 });

      const result = await runLoop({
        task,
        agentId: childAgentId,
        parentAgentId: ctx.agentId,
        depth: ctx.depth + 1,
        provider: deps.getProvider(),
        tools: deps.getTools(),
        systemPrompt: deps.systemPrompt,
        maxTurns: deps.maxTurns,
        confirm: deps.confirm,
      });

      bus.emit({
        type: "subagent_result",
        childAgentId,
        ok: result.ok,
        summary: result.finalText.slice(0, 200),
        agentId: ctx.agentId,
        turn: 0,
      });

      return result.finalText;
    },
  };
}
