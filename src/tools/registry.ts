// 把所有工具装配成一个列表。权限确认和分发在 loop 里做，这里只负责组装。
import type { Tool } from "../types.js";
import { readFile, writeFile, editFile, listDir } from "./fs.js";
import { bash, bashOutput, killShell } from "./bash.js";
import { grep, glob } from "./search.js";
import { webFetch } from "./web.js";
import { rememberTool } from "./memory.js";
import { todoWrite } from "./todo.js";
import { makeTaskTool, type TaskDeps } from "./task.js";

/** 组装全部工具。task 工具需要拿到完整列表（含自己），用闭包 getter 解决自引用。 */
export function buildTools(taskDeps: Omit<TaskDeps, "getTools">): Tool[] {
  const tools: Tool[] = [readFile, writeFile, editFile, listDir, bash, bashOutput, killShell, grep, glob, webFetch, rememberTool, todoWrite];
  tools.push(makeTaskTool({ ...taskDeps, getTools: () => tools }));
  return tools;
}
