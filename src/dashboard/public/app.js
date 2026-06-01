// 订阅 /events（SSE），把事件流渲染成 5 个视图。纯原生 JS，支持中/英切换。
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const short = (s, n = 120) => (s.length > n ? s.slice(0, n) + "…" : s);

// ========== i18n ==========
const I18N = {
  zh: {
    brandSub: "实时工作面板",
    statModel: "Provider / Model", statTurn: "轮数 (turn)", statTok: "累计 token", statCost: "累计成本",
    statCtx: "上下文占用（最近一次调用）",
    panelTimeline: "① 对话流", panelLlm: "② LLM 调用", panelLlmHint: "点开看原始报文 → 对比 provider",
    panelTools: "③ 工具调用", panelTree: "⑤ 多 Agent 协作树",
    connConnecting: "连接中…", connOn: "● 已连接", connOff: "○ 断开，重连中…",
    tagTask: "任务", tagAssistant: "助手", tagTool: "工具", tagSpawn: "派生", tagEnd: "结束",
    tagCompact: "🗜 压缩", tagError: "错误",
    llmOpen: "🔍 点击查看完整输入 / 输出", toolRunning: "运行中…",
    compactMeta: "上下文 {a} → {b} 条消息",
    modalTitle: "第 {n} 次调用", modalTools: "模型可用工具",
    modalInput: "📥 输入（发给模型的完整内容，共 {n} 条消息）", modalOutput: "📤 输出（模型返回）",
    modalRaw: "原始 JSON", rawReq: "rawRequest（原始请求）", rawResp: "raw（原始响应）",
    roleOut: "assistant（输出）", roleToolCalls: "tool_calls（要调的工具）",
    callPrefix: "调用", toolResult: "工具结果", empty: "(空)", noContent: "(无内容)",
    expandChars: "{n} 字，点击展开", charsN: "{n} 字",
  },
  en: {
    brandSub: "live work panel",
    statModel: "Provider / Model", statTurn: "Turns", statTok: "Total tokens", statCost: "Total cost",
    statCtx: "Context usage (last call)",
    panelTimeline: "① Conversation", panelLlm: "② LLM calls", panelLlmHint: "click a call → compare providers",
    panelTools: "③ Tool calls", panelTree: "⑤ Multi-agent tree",
    connConnecting: "Connecting…", connOn: "● Connected", connOff: "○ Disconnected, reconnecting…",
    tagTask: "Task", tagAssistant: "Assistant", tagTool: "Tool", tagSpawn: "Spawn", tagEnd: "End",
    tagCompact: "🗜 Compact", tagError: "Error",
    llmOpen: "🔍 click to see full input / output", toolRunning: "running…",
    compactMeta: "context {a} → {b} messages",
    modalTitle: "Call #{n}", modalTools: "tools",
    modalInput: "📥 Input (full content sent to the model — {n} messages)", modalOutput: "📤 Output (model reply)",
    modalRaw: "Raw JSON", rawReq: "rawRequest (raw request)", rawResp: "raw (raw response)",
    roleOut: "assistant (output)", roleToolCalls: "tool_calls (requested tools)",
    callPrefix: "call", toolResult: "tool result", empty: "(empty)", noContent: "(no content)",
    expandChars: "{n} chars, click to expand", charsN: "{n} chars",
  },
};

// 默认语言：localStorage 优先，否则按浏览器语言（非中文一律英文，利于国际访客）。
let lang = localStorage.getItem("glassbox-lang") || ((navigator.language || "en").startsWith("zh") ? "zh" : "en");

const t = (key, vars) => {
  let s = (I18N[lang] && I18N[lang][key]) ?? (I18N.en[key] ?? key);
  if (vars) for (const k in vars) s = s.replace(`{${k}}`, vars[k]);
  return s;
};

/** 把所有带 data-i18n 的元素文本刷成当前语言。 */
function applyI18n(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));
}

let connState = "connecting";
function renderConn() {
  const c = $("conn");
  c.textContent = connState === "on" ? t("connOn") : connState === "off" ? t("connOff") : t("connConnecting");
  c.classList.toggle("on", connState === "on");
}

function setLang(next) {
  lang = next;
  localStorage.setItem("glassbox-lang", lang);
  document.documentElement.lang = lang;
  applyI18n(document); // 刷新所有静态标签 + 已渲染的标签（tag 用了 data-i18n，会一起更新）
  renderConn();
  $("lang-toggle").textContent = lang === "zh" ? "EN" : "中文";
}

// ========== 状态 ==========
let totalIn = 0, totalOut = 0, totalCost = 0, maxTurn = 0, lastModel = "—";
const agents = {};
const toolEls = {};
const llmCalls = [];

const timeline = $("timeline"), llm = $("llm"), tools = $("tools"), tree = $("tree");

function autoscroll(el) {
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 60) el.scrollTop = el.scrollHeight;
}
function addRow(parent, html, sub) {
  const div = document.createElement("div");
  div.className = "row" + (sub ? " sub" : "");
  div.innerHTML = html;
  applyI18n(div); // 填充本行里的 data-i18n 标签
  parent.appendChild(div);
  autoscroll(parent);
  return div;
}
function renderStats() {
  $("s-model").textContent = lastModel;
  $("s-turn").textContent = maxTurn;
  $("s-tok").textContent = (totalIn + totalOut).toLocaleString();
  $("s-cost").textContent = "$" + totalCost.toFixed(5);
}
function renderTree() {
  tree.innerHTML = "";
  const roots = Object.keys(agents).filter((id) => !agents[id].parent);
  const draw = (id, depth) => {
    const a = agents[id];
    const node = document.createElement("div");
    node.className = "node " + a.state;
    node.style.marginLeft = depth * 16 + "px";
    node.innerHTML = `<span class="id">${esc(id)}</span> <span class="task">${esc(short(a.task || "", 70))}</span>`;
    tree.appendChild(node);
    Object.keys(agents).filter((c) => agents[c].parent === id).forEach((c) => draw(c, depth + 1));
  };
  roots.forEach((r) => draw(r, 0));
}

function handle(e) {
  const sub = !!e.parentAgentId;
  maxTurn = Math.max(maxTurn, e.turn || 0);

  switch (e.type) {
    case "conversation_start":
      agents[e.agentId] = { parent: e.parentAgentId, task: e.task, state: "running" };
      lastModel = `${e.provider} / ${e.model}`;
      addRow(timeline, `<span class="tag user" data-i18n="tagTask"></span><span class="txt">${esc(short(e.task, 200))}</span>`, sub);
      renderTree();
      break;

    case "llm_response": {
      totalIn += e.inputTokens; totalOut += e.outputTokens; totalCost += e.costUsd;
      lastModel = `${e.provider} / ${e.model}`;
      const pct = Math.min(100, (e.inputTokens / e.contextLimit) * 100);
      $("ctx-bar").style.width = pct + "%";
      $("ctx-text").textContent = `${e.inputTokens.toLocaleString()} / ${e.contextLimit.toLocaleString()} tok (${pct.toFixed(1)}%)`;
      if (e.text && e.text.trim())
        addRow(timeline, `<span class="tag assistant" data-i18n="tagAssistant"></span><span class="txt">${esc(e.text.trim())}</span>`, sub);

      const idx = llmCalls.push(e) - 1;
      const card = document.createElement("div");
      card.className = "call";
      card.innerHTML =
        `<div class="line"><span class="prov">#${idx + 1} ${esc(e.provider)}/${esc(e.model)}</span>` +
        `<span class="nums">${e.latencyMs}ms · in ${e.inputTokens} / out ${e.outputTokens} tok · $${e.costUsd.toFixed(5)} · ${esc(e.stopReason)}</span></div>` +
        `<div class="open" data-i18n="llmOpen"></div>`;
      applyI18n(card);
      card.onclick = () => openModal(idx);
      llm.appendChild(card); autoscroll(llm);
      renderStats();
      break;
    }

    case "tool_start": {
      addRow(timeline, `<span class="tag tool" data-i18n="tagTool"></span><b>${esc(e.name)}</b> <span class="meta">${esc(short(JSON.stringify(e.args), 120))}</span>`, sub);
      const el = document.createElement("div");
      el.className = "tool";
      el.innerHTML = `<div><span class="name">${esc(e.name)}</span> <span class="meta">${t("toolRunning")}</span></div><div class="args">${esc(short(JSON.stringify(e.args), 300))}</div><div class="res"></div>`;
      tools.appendChild(el); autoscroll(tools);
      toolEls[e.toolCallId] = el;
      break;
    }

    case "tool_result": {
      const el = toolEls[e.toolCallId];
      if (el) {
        el.querySelector(".meta").textContent = `${e.durationMs}ms · ${e.ok ? "✓" : "✗"}`;
        const res = el.querySelector(".res");
        res.textContent = e.resultPreview;
        if (!e.ok) res.classList.add("err");
      }
      break;
    }

    case "subagent_spawn":
      agents[e.childAgentId] = { parent: e.agentId, task: e.task, state: "running" };
      addRow(timeline, `<span class="tag agent" data-i18n="tagSpawn"></span><span class="meta"><b>${esc(e.childAgentId)}</b> ${esc(short(e.task, 100))}</span>`, sub);
      renderTree();
      break;

    case "subagent_result":
      if (agents[e.childAgentId]) agents[e.childAgentId].state = "done";
      renderTree();
      break;

    case "conversation_end":
      if (agents[e.agentId]) agents[e.agentId].state = "done";
      if (!sub) addRow(timeline, `<span class="tag ${e.ok ? "ok" : "err"}" data-i18n="tagEnd"></span><span class="meta">in ${e.totalInputTokens} / out ${e.totalOutputTokens} tok · $${e.totalCostUsd.toFixed(5)}</span>`);
      renderTree();
      break;

    case "compaction":
      addRow(timeline, `<span class="tag" data-i18n="tagCompact"></span><span class="meta">${t("compactMeta", { a: e.before, b: e.after })}</span>`, sub);
      break;

    case "error":
      addRow(timeline, `<span class="tag err" data-i18n="tagError"></span><span class="txt">${esc(e.message)}</span>`, sub);
      break;
  }
}

// ========== 详情弹窗（每次打开重建，总用当前语言） ==========
function block(text) {
  text = String(text == null ? "" : text);
  if (!text) return `<pre class="empty">${t("empty")}</pre>`;
  if (text.length > 500)
    return `<details><summary>${t("expandChars", { n: text.length.toLocaleString() })}</summary><pre>${esc(text)}</pre></details>`;
  return `<pre>${esc(text)}</pre>`;
}
function block2(text) {
  text = String(text == null ? "" : text);
  if (text.length > 200) return `<details class="inline"><summary>${t("charsN", { n: text.length })}</summary><pre>${esc(text)}</pre></details>`;
  return esc(text);
}
function renderMessage(role, m) {
  let body = "";
  if (typeof m.content === "string") body += block(m.content);
  else if (Array.isArray(m.content)) {
    for (const b of m.content) {
      if (b.type === "text") body += block(b.text);
      else if (b.type === "tool_use") body += `<div class="tcall">→ ${t("callPrefix")} ${esc(b.name)}(${block2(JSON.stringify(b.input))})</div>`;
      else if (b.type === "tool_result") body += `<div class="tres">${t("toolResult")}:${block(typeof b.content === "string" ? b.content : JSON.stringify(b.content))}</div>`;
    }
  }
  if (m.tool_calls) for (const c of m.tool_calls) body += `<div class="tcall">→ ${t("callPrefix")} ${esc(c.function.name)}(${block2(c.function.arguments)})</div>`;
  return `<div class="msg role-${esc(role.split(/[（(]/)[0].trim())}"><div class="role">${esc(role)}</div><div class="mbody">${body || `<pre class="empty">${t("noContent")}</pre>`}</div></div>`;
}
function outputToolCalls(raw) {
  if (raw && raw.choices && raw.choices[0] && raw.choices[0].message && raw.choices[0].message.tool_calls)
    return raw.choices[0].message.tool_calls.map((c) => `${c.function.name}(${c.function.arguments})`);
  if (raw && Array.isArray(raw.content))
    return raw.content.filter((b) => b.type === "tool_use").map((b) => `${b.name}(${JSON.stringify(b.input)})`);
  return [];
}
function openModal(idx) {
  const e = llmCalls[idx];
  const req = e.rawRequest || {};
  const msgs = Array.isArray(req.messages) ? req.messages.slice() : [];
  if (req.system) msgs.unshift({ role: "system", content: req.system });
  const toolNames = (req.tools || []).map((x) => (x.function ? x.function.name : x.name)).filter(Boolean);

  const inputHtml = msgs.map((m) => renderMessage(m.role, m)).join("");
  const outCalls = outputToolCalls(e.raw);
  const outputHtml =
    renderMessage(t("roleOut"), { content: e.text }) +
    (outCalls.length ? `<div class="msg role-assistant"><div class="role">${t("roleToolCalls")}</div><div class="mbody">${outCalls.map((c) => `<div class="tcall">→ ${block2(c)}</div>`).join("")}</div></div>` : "");

  $("modal-title").textContent = `${t("modalTitle", { n: idx + 1 })} · ${e.provider}/${e.model}`;
  $("modal-meta").textContent = `${e.latencyMs}ms · in ${e.inputTokens} / out ${e.outputTokens} tok · $${e.costUsd.toFixed(5)} · ${e.stopReason} · ${t("modalTools")}: ${toolNames.join(", ")}`;
  $("modal-body").innerHTML =
    `<h3>${t("modalInput", { n: msgs.length })}</h3>${inputHtml}` +
    `<h3>${t("modalOutput")}</h3>${outputHtml}` +
    `<h3>${t("modalRaw")}</h3>` +
    `<details><summary>${t("rawReq")}</summary><pre>${esc(JSON.stringify(req, null, 2))}</pre></details>` +
    `<details><summary>${t("rawResp")}</summary><pre>${esc(JSON.stringify(e.raw, null, 2))}</pre></details>`;
  $("modal").classList.remove("hidden");
}
function closeModal() { $("modal").classList.add("hidden"); }
$("modal-close").onclick = closeModal;
$("modal").onclick = (ev) => { if (ev.target.id === "modal") closeModal(); };
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") closeModal(); });

// ========== 语言初始化 ==========
$("lang-toggle").onclick = () => setLang(lang === "zh" ? "en" : "zh");
setLang(lang); // 应用初始语言（含静态标签 + 连接状态 + 按钮文字）

// ========== SSE 订阅 ==========
const srcEvt = new EventSource("/events");
srcEvt.onopen = () => { connState = "on"; renderConn(); };
srcEvt.onerror = () => { connState = "off"; renderConn(); };
srcEvt.onmessage = (m) => { try { handle(JSON.parse(m.data)); } catch (err) { console.error(err); } };
