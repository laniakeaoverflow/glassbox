# Contributing to glassbox

Thanks for your interest! glassbox is intentionally **small and readable** — it's a great place to learn how agentic coding tools work, or to make your first open-source contribution.

## Ground rules

- **Keep it readable.** This is a learning project; clarity beats cleverness. Match the surrounding style and comment density.
- **Keep changes focused.** One idea per PR. Small PRs get reviewed fast.
- **No new heavy dependencies** without discussion — the core is meant to stay tiny.

## Dev setup

```bash
git clone https://github.com/laniakeaoverflow/glassbox.git
cd glassbox
npm install
npm run dev        # run it (needs an API key in .env — see README)
npm test           # run the unit tests (NO API key needed)
npx tsc --noEmit   # type-check
```

Before opening a PR, make sure **`npx tsc --noEmit && npm test`** is green. If you add pure logic, add a test for it (see `test/` for the style — fake providers, temp dirs, no network).

## Architecture in one line

An **event bus is the spine**: the agent loop (`src/agent/loop.ts`) emits an event at every step, and the terminal, the dashboard, and the session log are all just subscribers. To make something new visible, emit an event — don't add a side channel. See the README's "How it works" and `src/agent/loop.ts`.

## Good first issues

Check the [`good first issue`](https://github.com/laniakeaoverflow/glassbox/labels/good%20first%20issue) label. Some ideas always welcome:

- A new tool (the bar: small, readable, emits proper events).
- A new dashboard view or polish.
- Docs, examples, and a real demo screenshot/GIF.

## Submitting

1. Fork & branch (`git checkout -b my-change`).
2. Make the change; keep it focused; run the checks above.
3. Open a PR describing **what** and **why**. Screenshots/GIFs welcome for UI changes.

By contributing, you agree your contributions are licensed under the [MIT License](LICENSE).
