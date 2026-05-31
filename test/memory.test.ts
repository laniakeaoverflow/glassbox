// 验证记忆模块：静态 GLASSBOX.md 注入 + remember 追加 + 跨"会话"加载回来。
// 用 GLASSBOX_DIR 注入临时根目录、用临时 cwd，不碰真实记忆。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadMemory, remember, agentMemoryPath } from "../src/memory.ts";

function tmp() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gb-mem-root-"));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "gb-mem-cwd-"));
  process.env.GLASSBOX_DIR = root;
  return { root, cwd };
}

test("无任何记忆时 loadMemory 返回空串", () => {
  const { cwd } = tmp();
  assert.equal(loadMemory(cwd), "");
});

test("项目 GLASSBOX.md 会被加载进记忆段", () => {
  const { cwd } = tmp();
  fs.writeFileSync(path.join(cwd, "GLASSBOX.md"), "本项目用 pnpm，不用 npm。");
  const mem = loadMemory(cwd);
  assert.match(mem, /# 记忆/);
  assert.match(mem, /项目记忆/);
  assert.match(mem, /用 pnpm/);
});

test("remember 追加进 MEMORY.md，下次 loadMemory 能读回（跨会话）", async () => {
  const { cwd } = tmp();
  const r = await remember(cwd, "构建命令是 npm run build");
  assert.match(r, /已记住/);
  assert.ok(fs.existsSync(agentMemoryPath(cwd)), "MEMORY.md 应被创建");
  // 再来一条
  await remember(cwd, "测试用 npm test");
  const mem = loadMemory(cwd); // 模拟新会话重新加载
  assert.match(mem, /历史会话学到的经验/);
  assert.match(mem, /构建命令是 npm run build/);
  assert.match(mem, /测试用 npm test/);
});

test("全局 + 项目记忆都会注入", () => {
  const { root, cwd } = tmp();
  fs.writeFileSync(path.join(root, "GLASSBOX.md"), "全局偏好：回复用中文。");
  fs.writeFileSync(path.join(cwd, "GLASSBOX.md"), "项目：这是 glassbox。");
  const mem = loadMemory(cwd);
  assert.match(mem, /全局偏好/);
  assert.match(mem, /这是 glassbox/);
});
