# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/), and this
project adheres to [Semantic Versioning](https://semver.org/).

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

[0.5.0]: https://github.com/laniakeaoverflow/glassbox/releases/tag/v0.5.0
[0.4.0]: https://github.com/laniakeaoverflow/glassbox/releases/tag/v0.4.0
[0.3.0]: https://github.com/laniakeaoverflow/glassbox/releases/tag/v0.3.0
[0.2.0]: https://github.com/laniakeaoverflow/glassbox/releases/tag/v0.2.0
[0.1.1]: https://github.com/laniakeaoverflow/glassbox/releases/tag/v0.1.1
[0.1.0]: https://github.com/laniakeaoverflow/glassbox/releases/tag/v0.1.0
