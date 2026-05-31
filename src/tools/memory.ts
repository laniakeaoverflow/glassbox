// remember 工具：让 agent 把值得跨会话记住的经验存进项目记忆。
// 这是「agent 自己写记忆」那一族（类比 Claude Code 的 auto memory）。
import type { Tool } from "../types.js";
import { remember } from "../memory.js";

export const rememberTool: Tool = {
  name: "remember",
  description:
    "把一条值得跨会话记住的事实/经验存进本项目记忆（如：构建命令、项目约定、踩过的坑、用户偏好）。下次启动会自动加载进上下文。只记真正长期有用的，别记一次性的琐事。",
  parameters: {
    type: "object",
    properties: { note: { type: "string", description: "要记住的一句话" } },
    required: ["note"],
  },
  async execute(input) {
    return remember(process.cwd(), String(input.note));
  },
};
