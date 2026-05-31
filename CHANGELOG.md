# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/), and this
project adheres to [Semantic Versioning](https://semver.org/).

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

[0.1.0]: https://github.com/laniakeaoverflow/glassbox/releases/tag/v0.1.0
