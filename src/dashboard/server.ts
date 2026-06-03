// 仪表盘后端：极简 http 服务，做两件事——
//  1. 提供 public/ 下的静态页面
//  2. /events 用 SSE 把事件实时推给浏览器
// 只绑 127.0.0.1，因为事件里会带文件内容等敏感信息。
import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bus } from "../events/bus.js";
import type { AgentEvent } from "../events/types.js";

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

export function startDashboard(port: number): http.Server {
  // 留一份近期事件，晚连上来的浏览器也能看到历史。
  const backlog: AgentEvent[] = [];
  bus.on((e) => {
    if (e.type === "llm_delta") return; // 流式增量不留底：晚连上来的浏览器看最终 llm_response 即可，避免冲爆 backlog
    backlog.push(e);
    if (backlog.length > 1000) backlog.shift();
  });

  const server = http.createServer(async (req, res) => {
    const url = (req.url ?? "/").split("?")[0];

    if (url === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      // 先补发历史，再订阅实时。
      for (const e of backlog) res.write(`data: ${JSON.stringify(e)}\n\n`);
      const off = bus.on((e) => res.write(`data: ${JSON.stringify(e)}\n\n`));
      req.on("close", off);
      return;
    }

    // 静态文件
    const file = url === "/" ? "index.html" : url.slice(1);
    try {
      const body = await fs.readFile(path.join(PUBLIC, file));
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });

  server.listen(port, "127.0.0.1");
  return server;
}
