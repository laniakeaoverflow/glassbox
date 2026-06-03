# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/), and this
project adheres to [Semantic Versioning](https://semver.org/).

## [0.8.0] — 2026-06-03

### Added
- **System prompt, rewritten.** More "tuned" toward Claude Code's core discipline: concise output, tool-first, read-before-edit, and a directive to use `todo_write` for any 3+ step task — while staying readable (it's a learning project).
- **`todo_write` tool + plan panel.** The agent maintains a live checklist (statuses `pending` / `in_progress` / `completed`, full-list replace, at most one `in_progress`). Emits a `todo_update` event rendered as a new **④ Plan panel** in the dashboard and a checklist in the terminal.
- **`<system-reminder>` injection channel.** The harness can inject reminders into the model mid-conversation (the framework→model steering channel): a startup git/cwd snapshot, and the live todo list re-fed each turn. Each injection emits a `reminder` event the dashboard marks with a distinct `💉 injected` tag — so you can *see* the harness steering the model.

### Fixed
- **OpenAI/DeepSeek message ordering.** When a single user message carries both tool results and an injected reminder, `tool` messages are now emitted before the user text, so OpenAI-compatible providers don't reject the request.

## [0.7.0] — 2026-06-02

### Added
- **Streaming responses.** Providers can stream token-by-token via an optional `onDelta` callback; the loop emits `llm_delta` events. The terminal types the main agent's reply live, and the dashboard grows the assistant message and **assembles tool-call argument JSON character-by-character**. Anthropic (`messages.stream`) and OpenAI-compatible (`stream: true`) both supported; the non-streaming path is untouched. Toggle with `STREAM=0`.
- Streaming deltas are deliberately not persisted to the session log or dashboard backlog (the final `llm_response` already carries the full text), keeping logs and replay clean.

## [0.6.0] — 2026-06-01

### Added
- **Bilingual dashboard (中文 / English).** A one-click language toggle in the header; defaults to the browser language (English for non-Chinese visitors), remembered in `localStorage`. All labels, tags, and the input/output modal are translated.

## [0.5.0] — 2026-06-01

### Added
- **Memory (à la Claude Code).** Two tiers, both auto-loaded into the system prompt at startup so the agent isn't amnesiac across sessions:
  - **Static memory** you write — `~/.glassbox/GLASSBOX.md` (all projects) and `./GLASSBOX.md` (this project).
  - **Agent memory** it writes — a new `remember` tool appends learnings to a per-project `MEMORY.md` that loads back next time.
  - `/memory` lists the sources and shows what's loaded.

## [0.4.0] — 2026-06-01

### Added
- **`web_fetch` tool.** The agent can now fetch a URL and read its main text (HTML stripped, truncated) — useful for looking things up or reading docs.

## [0.3.0] — 2026-06-01

### Added
- **Session replay — try it with no API key.** `glassbox --replay <file.jsonl>` (or `npm run replay`) plays a recorded session back into the dashboard and terminal. A sample recording ships in `examples/`, so anyone can experience the dashboard instantly without signing up for a model provider.

### Fixed
- Session logs are now flushed before exit, so the final events (e.g. `conversation_end`) are no longer occasionally dropped.

## [0.2.0] — 2026-06-01

### Added
- **Context compaction.** When the history approaches the model's context window (default 70%), older messages are summarized into a single progress note while the task and recent turns are kept intact — so long sessions don't blow the context limit or keep getting more expensive. Shown in the terminal, the dashboard, and session logs. Tunable via `COMPACT_THRESHOLD`.
- **CI.** GitHub Actions runs type-checking and the test suite on every push/PR.

## [0.1.1] — 2026-05-31

### Fixed
- **Truncation defense.** When a model response is cut off at its output limit (`finish_reason: length` / `stop_reason: max_tokens`), its tool call is incomplete and its arguments parse to `{}`. The agent now:
  - **Detects truncation** and, instead of running the broken tool call, tells the model its reply was truncated so it can shorten or write large files in chunks.
  - **Validates required tool arguments** before executing — a missing arg now returns a clear error instead of silently writing a junk `undefined` file and reporting success.

## [0.1.0] — 2026-05-31

First public release. 🎉

### Core
- Reentrant **agent loop** (`runLoop`) shared by the main agent and sub-agents.
- **Event bus** as the backbone — terminal, dashboard, and session logs are all subscribers.

### Providers
- Provider abstraction with normalized tool-calling across protocols.
- **Anthropic** (native Messages API) and **OpenAI-compatible** adapters.
- First-class **DeepSeek** provider; switch live with the `/model` arrow-key menu.
- Per-model `max_tokens` taken from the model's real output limit.

### Tools
- File tools (read / write / edit / list), `grep` / `glob` search.
- `bash` with managed **background processes** (`run_in_background` + `bash_output` + `kill_shell`), à la Claude Code.
- `task` tool to spawn sub-agents.
- Terminal permission prompts for dangerous operations.

### UX
- From-scratch **raw-mode line editor**: bracketed-paste multiline input, Option+Enter / `\` continuation, arrow-key model picker.
- Real-time **web dashboard** (SSE): conversation flow, per-call LLM details with full raw request/response, tool calls, context usage, multi-agent tree.
- **Session logging**: every run recorded as a readable `.log` and a complete `.jsonl`.

[0.8.0]: https://github.com/laniakeaoverflow/glassbox/releases/tag/v0.8.0
[0.7.0]: https://github.com/laniakeaoverflow/glassbox/releases/tag/v0.7.0
[0.6.0]: https://github.com/laniakeaoverflow/glassbox/releases/tag/v0.6.0
[0.5.0]: https://github.com/laniakeaoverflow/glassbox/releases/tag/v0.5.0
[0.4.0]: https://github.com/laniakeaoverflow/glassbox/releases/tag/v0.4.0
[0.3.0]: https://github.com/laniakeaoverflow/glassbox/releases/tag/v0.3.0
[0.2.0]: https://github.com/laniakeaoverflow/glassbox/releases/tag/v0.2.0
[0.1.1]: https://github.com/laniakeaoverflow/glassbox/releases/tag/v0.1.1
[0.1.0]: https://github.com/laniakeaoverflow/glassbox/releases/tag/v0.1.0
