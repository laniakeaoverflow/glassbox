// 验证会话日志器：启动后建 .log + .jsonl，事件写进去，完整结果不被截断。
// 用 GLASSBOX_LOG_DIR 注入临时目录，不碰真实日志目录、不需要 API key。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startSessionLog } from "../src/logging/session-log.ts";
import { bus } from "../src/events/bus.ts";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("每次启动生成 .log + .jsonl，并完整记录事件", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcc-log-"));
  process.env.GLASSBOX_LOG_DIR = dir;

  const s = startSessionLog({ provider: "fake", model: "m", cwd: "/tmp/x" });

  const longResult = "完整结果内容-" + "x".repeat(50);
  bus.emit({ type: "conversation_start", provider: "fake", model: "m", task: "测试任务ABC", agentId: "a1", turn: 0 });
  bus.emit({ type: "tool_start", toolCallId: "t1", name: "read_file", args: { path: "y" }, agentId: "a1", turn: 1 });
  bus.emit({ type: "tool_result", toolCallId: "t1", name: "read_file", ok: true, resultPreview: "完整结果内容-x…", result: longResult, durationMs: 5, agentId: "a1", turn: 1 });
  bus.emit({ type: "error", where: "loop", message: "炸了BOOM", agentId: "a1", turn: 1 });
  s.close();
  await delay(150); // 等流 flush

  // 两个文件都建了
  assert.ok(fs.existsSync(s.logPath), ".log 应存在");
  assert.ok(fs.existsSync(s.jsonlPath), ".jsonl 应存在");
  assert.ok(path.basename(s.logPath).startsWith("session-"));

  // 可读 .log：含任务、工具名、完整结果、错误
  const logTxt = fs.readFileSync(s.logPath, "utf8");
  assert.match(logTxt, /测试任务ABC/);
  assert.match(logTxt, /read_file/);
  assert.match(logTxt, /炸了BOOM/);
  assert.ok(logTxt.includes(longResult), ".log 应含完整结果");

  // 机器 .jsonl：首行 session_start，每行可解析，tool_result.result 是完整的
  const lines = fs.readFileSync(s.jsonlPath, "utf8").trim().split("\n");
  const parsed = lines.map((l) => JSON.parse(l)); // 不抛 = 每行都是合法 JSON
  assert.equal(parsed[0].type, "session_start");
  const tr = parsed.find((e) => e.type === "tool_result");
  assert.equal(tr.result, longResult, ".jsonl 里 result 应完整不截断");
});
