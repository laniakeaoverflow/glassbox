// 事件是整个系统的脊柱：agent 循环每走一步就发一个事件，
// 终端 printer 和 Web 面板都只是订阅者。

/** 所有事件共享的信封。agentId/parentAgentId 让多 agent 协作树成立——从第一天就埋。 */
export interface Envelope {
  id: number; // 自增序号
  ts: number; // 时间戳 ms
  agentId: string;
  parentAgentId?: string;
  turn: number; // 当前在第几轮 LLM 调用
}

export type AgentEvent = Envelope &
  (
    | { type: "conversation_start"; provider: string; model: string; task: string }
    | { type: "llm_request"; provider: string; model: string; messageCount: number }
    | {
        type: "llm_response";
        provider: string;
        model: string;
        latencyMs: number;
        inputTokens: number;
        outputTokens: number;
        costUsd: number;
        contextLimit: number; // 该模型上下文窗口大小，给面板算占用率
        stopReason: string;
        text: string;
        raw: unknown; // 原始响应报文，面板可展开
        rawRequest: unknown; // 原始请求报文（含完整消息历史，无 key）——日志/对比用
      }
    | {
        // 流式增量：文本逐 token、工具调用增量拼装。量大且最终 llm_response 已含全文，
        // 故不进 dashboard backlog、不写 session-log（见 server.ts / session-log.ts）。
        type: "llm_delta";
        kind: "text" | "tool_start" | "tool_input";
        text?: string;
        toolIndex?: number;
        toolId?: string;
        toolName?: string;
        partialJson?: string;
      }
    | { type: "tool_start"; toolCallId: string; name: string; args: Record<string, unknown> }
    | {
        type: "tool_result";
        toolCallId: string;
        name: string;
        ok: boolean;
        resultPreview: string; // 截断预览，给终端/面板用
        result: string; // 完整结果，给日志用
        durationMs: number;
      }
    | { type: "permission_request"; toolCallId: string; name: string; args: Record<string, unknown> }
    | { type: "permission_resolved"; toolCallId: string; approved: boolean }
    | { type: "subagent_spawn"; childAgentId: string; task: string }
    | { type: "subagent_result"; childAgentId: string; ok: boolean; summary: string }
    | { type: "todo_update"; todos: { content: string; status: string }[] } // TodoWrite：当前计划清单（全量）
    | { type: "reminder"; source: string; text: string } // 框架注入给模型的 system-reminder（如 todo 状态、git 状态）
    | { type: "compaction"; before: number; after: number } // 上下文压缩：消息数 before→after
    | { type: "conversation_end"; ok: boolean; totalInputTokens: number; totalOutputTokens: number; totalCostUsd: number }
    | { type: "error"; where: string; message: string }
  );

export type EventType = AgentEvent["type"];
