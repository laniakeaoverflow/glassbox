// 验证后台进程管理：启动→读输出→终止。不碰网络、不需要 key。
import test from "node:test";
import assert from "node:assert/strict";
import { startBackground, readBackground, killBackground, killAllBackground } from "../src/tools/shells.ts";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("后台启动立即返回，输出可读，能按 id 终止", async () => {
  // 一个每 0.1s 打印一次、不会自己结束的进程
  const s = startBackground(`sh -c 'for i in 1 2 3 4 5 6 7 8 9 10; do echo tick-$i; sleep 0.1; done'`, process.cwd());
  assert.match(s.id, /^bg_\d+$/);
  assert.equal(s.status, "running");

  await delay(350); // 让它打印几行
  const out = readBackground(s.id);
  assert.match(out, /运行中/);
  assert.match(out, /tick-1/); // 读到了后台输出

  const killed = killBackground(s.id);
  assert.match(killed, /已终止/);
  await delay(50);
  assert.equal(s.status, "killed");
});

test("读不存在的 id 给出友好提示", () => {
  assert.match(readBackground("bg_999"), /未找到/);
});

test("后台命令正常结束后状态变 exited", async () => {
  const s = startBackground(`echo hi-done`, process.cwd());
  await delay(200);
  const out = readBackground(s.id);
  assert.match(out, /已退出/);
  assert.match(out, /hi-done/);
});

test("killAll 回收所有运行中的后台进程", async () => {
  const a = startBackground(`sleep 30`, process.cwd());
  const b = startBackground(`sleep 30`, process.cwd());
  await delay(50);
  killAllBackground();
  await delay(100);
  assert.notEqual(a.status, "running");
  assert.notEqual(b.status, "running");
});
