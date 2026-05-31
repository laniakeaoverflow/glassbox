// 订阅 /events（SSE），把事件流渲染成 5 个视图。纯原生 JS。
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const short = (s, n = 120) => (s.length > n ? s.slice(0, n) + "…" : s);

// 聚合状态
let totalIn = 0, totalOut = 0, totalCost = 0, maxTurn = 0, lastModel = "—";
const agents = {}; // agentId -> {parent, task, state}
const toolEls = {}; // toolCallId -> DOM 节点
const llmCalls = []; // 每次 llm_response 事件，供详情弹窗用

const timeline = $("timeline"), llm = $("llm"), tools = $("tools"), tree = $("tree");

function autoscroll(el) {
  // 只在已经贴底时才自动滚，免得打断用户翻看历史。
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 60) el.scrollTop = el.scrollHeight;
}

function addRow(parent, html, sub) {
  const div = document.createElement("div");
  div.className = "row" + (sub ? " sub" : "");
  div.innerHTML = html;
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
      addRow(timeline, `<span class="tag user">任务</span><span class="txt">${esc(short(e.task, 200))}</span>`, sub);
      renderTree();
      break;

    case "llm_response": {
      totalIn += e.inputTokens; totalOut += e.outputTokens; totalCost += e.costUsd;
      lastModel = `${e.provider} / ${e.model}`;
      // 上下文占用 = 最近一次调用的输入 token / 窗口大小
      const pct = Math.min(100, (e.inputTokens / e.contextLimit) * 100);
      $("ctx-bar").style.width = pct + "%";
      $("ctx-text").textContent = `${e.inputTokens.toLocaleString()} / ${e.contextLimit.toLocaleString()} tok (${pct.toFixed(1)}%)`;

      if (e.text && e.text.trim())
        addRow(timeline, `<span class="tag assistant">助手</span><span class="txt">${esc(e.text.trim())}</span>`, sub);

      // 视图2：LLM 调用卡片，点击查看完整输入/输出
      const idx = llmCalls.push(e) - 1;
      const card = document.createElement("div");
      card.className = "call";
      card.innerHTML =
        `<div class="line"><span class="prov">#${idx + 1} ${esc(e.provider)}/${esc(e.model)}</span>` +
        `<span class="nums">${e.latencyMs}ms · in ${e.inputTokens} / out ${e.outputTokens} tok · $${e.costUsd.toFixed(5)} · ${esc(e.stopReason)}</span></div>` +
        `<div class="open">🔍 点击查看完整输入 / 输出</div>`;
      card.onclick = () => openModal(idx);
      llm.appendChild(card); autoscroll(llm);
      renderStats();
      break;
    }

    case "tool_start": {
      addRow(timeline, `<span class="tag tool">工具</span><b>${esc(e.name)}</b> <span class="meta">${esc(short(JSON.stringify(e.args), 120))}</span>`, sub);
      const el = document.createElement("div");
      el.className = "tool";
      el.innerHTML = `<div><span class="name">${esc(e.name)}</span> <span class="meta">运行中…</span></div><div class="args">${esc(short(JSON.stringify(e.args), 300))}</div><div class="res"></div>`;
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
      addRow(timeline, `<span class="tag agent">派生</span>子 agent <b>${esc(e.childAgentId)}</b>：<span class="meta">${esc(short(e.task, 100))}</span>`, sub);
      renderTree();
      break;

    case "subagent_result":
      if (agents[e.childAgentId]) agents[e.childAgentId].state = "done";
      renderTree();
      break;

    case "conversation_end":
      if (agents[e.agentId]) agents[e.agentId].state = "done";
      if (!sub) addRow(timeline, `<span class="tag ${e.ok ? "ok" : "err"}">结束</span><span class="meta">in ${e.totalInputTokens} / out ${e.totalOutputTokens} tok · $${e.totalCostUsd.toFixed(5)}</span>`);
      renderTree();
      break;

    case "error":
      addRow(timeline, `<span class="tag err">错误</span><span class="txt">${esc(e.message)}</span>`, sub);
      break;
  }
}

// ========== 完整输入/输出 详情弹窗 ==========

// 长文本默认折叠（如 17k 的 HTML），点击展开。
function block(text) {
  text = String(text == null ? "" : text);
  if (!text) return `<pre class="empty">(空)</pre>`;
  if (text.length > 500)
    return `<details><summary>${text.length.toLocaleString()} 字，点击展开</summary><pre>${esc(text)}</pre></details>`;
  return `<pre>${esc(text)}</pre>`;
}

// 把一条 message 渲染成一个角色气泡。兼容两种协议：
//  - OpenAI/DeepSeek: content 是字符串，工具调用在 m.tool_calls，工具结果是 role:"tool"
//  - Anthropic: content 是块数组（text / tool_use / tool_result）
function renderMessage(role, m) {
  let body = "";
  if (typeof m.content === "string") {
    body += block(m.content);
  } else if (Array.isArray(m.content)) {
    for (const b of m.content) {
      if (b.type === "text") body += block(b.text);
      else if (b.type === "tool_use") body += `<div class="tcall">→ 调用 ${esc(b.name)}(${block2(JSON.stringify(b.input))})</div>`;
      else if (b.type === "tool_result") body += `<div class="tres">工具结果:${block(typeof b.content === "string" ? b.content : JSON.stringify(b.content))}</div>`;
    }
  }
  if (m.tool_calls) for (const c of m.tool_calls) body += `<div class="tcall">→ 调用 ${esc(c.function.name)}(${block2(c.function.arguments)})</div>`;
  return `<div class="msg role-${esc(role)}"><div class="role">${esc(role)}</div><div class="mbody">${body || '<pre class="empty">(无内容)</pre>'}</div></div>`;
}

function block2(text) { // 行内版折叠（给工具参数）
  text = String(text == null ? "" : text);
  if (text.length > 200) return `<details class="inline"><summary>${text.length} 字</summary><pre>${esc(text)}</pre></details>`;
  return esc(text);
}

// 从原始响应里提取模型这次要调的工具（两种协议）
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
  // Anthropic 的 system 是顶层字段，补成第一条
  if (req.system) msgs.unshift({ role: "system", content: req.system });
  const tools = (req.tools || []).map((t) => (t.function ? t.function.name : t.name)).filter(Boolean);

  const inputHtml = msgs.map((m) => renderMessage(m.role, m)).join("");
  const outCalls = outputToolCalls(e.raw);
  const outputHtml =
    renderMessage("assistant（输出）", { content: e.text }) +
    (outCalls.length ? `<div class="msg role-assistant"><div class="role">tool_calls（要调的工具）</div><div class="mbody">${outCalls.map((c) => `<div class="tcall">→ ${block2(c)}</div>`).join("")}</div></div>` : "");

  $("modal-title").textContent = `第 ${idx + 1} 次调用 · ${e.provider}/${e.model}`;
  $("modal-meta").textContent = `${e.latencyMs}ms · in ${e.inputTokens} / out ${e.outputTokens} tok · $${e.costUsd.toFixed(5)} · ${e.stopReason} · 模型可用工具: ${tools.join(", ")}`;
  $("modal-body").innerHTML =
    `<h3>📥 输入（发给模型的完整内容，共 ${msgs.length} 条消息）</h3>${inputHtml}` +
    `<h3>📤 输出（模型返回）</h3>${outputHtml}` +
    `<h3>原始 JSON</h3>` +
    `<details><summary>rawRequest（原始请求）</summary><pre>${esc(JSON.stringify(req, null, 2))}</pre></details>` +
    `<details><summary>raw（原始响应）</summary><pre>${esc(JSON.stringify(e.raw, null, 2))}</pre></details>`;
  $("modal").classList.remove("hidden");
}

function closeModal() { $("modal").classList.add("hidden"); }
$("modal-close").onclick = closeModal;
$("modal").onclick = (ev) => { if (ev.target.id === "modal") closeModal(); };
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") closeModal(); });

// ========== SSE 订阅 ==========
const src = new EventSource("/events");
src.onopen = () => { const c = $("conn"); c.textContent = "● 已连接"; c.classList.add("on"); };
src.onerror = () => { const c = $("conn"); c.textContent = "○ 断开，重连中…"; c.classList.remove("on"); };
src.onmessage = (m) => { try { handle(JSON.parse(m.data)); } catch (err) { console.error(err); } };
