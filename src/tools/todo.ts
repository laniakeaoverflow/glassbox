// todo_write 工具：仿 Claude Code 的 TodoWrite——模型把整张计划清单全量传进来，
// 框架(1) 发 todo_update 事件让面板画出计划演进，(2) 通过 ctx.remind 把当前清单作为
// system-reminder 回灌，使 todo 状态在后续轮次保持鲜活（这正是 ②TodoWrite 和 ③注入的咬合点）。
import type { Tool, TodoItem, TodoStatus } from "../types.js";
import { bus } from "../events/bus.js";

const STATUSES: TodoStatus[] = ["pending", "in_progress", "completed"];
const MARK: Record<TodoStatus, string> = { pending: "[ ]", in_progress: "[~]", completed: "[x]" };

/** 校验并归一化模型传来的 todos（纯逻辑，可单测）。出错抛 Error，由工具层兜成报错回灌。 */
export function parseTodos(input: unknown): TodoItem[] {
  if (!Array.isArray(input)) throw new Error("todos 必须是数组");
  const todos = input.map((raw, i) => {
    const o = (raw ?? {}) as Record<string, unknown>;
    const content = typeof o.content === "string" ? o.content.trim() : "";
    if (!content) throw new Error(`第 ${i + 1} 项缺少 content`);
    const status = o.status as TodoStatus;
    if (!STATUSES.includes(status)) throw new Error(`第 ${i + 1} 项 status 非法：${String(o.status)}（应为 ${STATUSES.join(" / ")}）`);
    return { content, status };
  });
  if (todos.filter((t) => t.status === "in_progress").length > 1)
    throw new Error("同一时刻最多只能有一项 in_progress");
  return todos;
}

/** 把清单渲染成带勾选框的可读文本（终端/工具结果/reminder 共用）。 */
export function formatTodos(todos: TodoItem[]): string {
  if (!todos.length) return "（空计划）";
  return todos.map((t) => `${MARK[t.status]} ${t.content}`).join("\n");
}

export const todoWrite: Tool = {
  name: "todo_write",
  description:
    "维护当前任务的计划清单（待办列表）。每次传入完整清单（全量替换）。3 步以上的任务应一开始就用它列计划，并随进度更新：开始某项前标 in_progress，做完标 completed。同一时刻最多一项 in_progress。",
  parameters: {
    type: "object",
    properties: {
      todos: {
        type: "array",
        description: "完整的待办清单",
        items: {
          type: "object",
          properties: {
            content: { type: "string", description: "这一步要做什么" },
            status: { type: "string", enum: STATUSES, description: "pending / in_progress / completed" },
          },
          required: ["content", "status"],
        },
      },
    },
    required: ["todos"],
  },
  async execute(input, ctx) {
    const todos = parseTodos(input.todos);
    bus.emit({ type: "todo_update", todos, agentId: ctx.agentId, turn: 0 });
    // 把当前清单作为 system-reminder 回灌给模型，让它后续轮次始终"看得见"自己的计划。
    ctx.remind?.("todo", `当前计划清单（保持更新）：\n${formatTodos(todos)}`);
    return `计划已更新：\n${formatTodos(todos)}`;
  },
};
