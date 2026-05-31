// 验证 web_fetch：HTML→文本 的纯函数，以及非法 url 的守卫。（不依赖真实网络。）
import test from "node:test";
import assert from "node:assert/strict";
import { htmlToText, webFetch } from "../src/tools/web.ts";

test("htmlToText：去掉 script/style/标签，解实体，压空白", () => {
  const html = `<html><head><style>.x{color:red}</style></head>
    <body><h1>标题</h1><script>alert(1)</script><p>正文 &amp; 内容 &lt;ok&gt;</p></body></html>`;
  const txt = htmlToText(html);
  assert.match(txt, /标题/);
  assert.match(txt, /正文 & 内容 <ok>/);
  assert.doesNotMatch(txt, /alert/); // script 被去掉
  assert.doesNotMatch(txt, /color:red/); // style 被去掉
  assert.doesNotMatch(txt, /<h1>|<p>/); // HTML 标签被去掉
});

test("web_fetch：非 http(s) url 直接报错（不发请求）", async () => {
  await assert.rejects(() => webFetch.execute({ url: "ftp://x" }, { agentId: "t", depth: 0 }), /http/);
  await assert.rejects(() => webFetch.execute({ url: "file:///etc/passwd" }, { agentId: "t", depth: 0 }), /http/);
});
