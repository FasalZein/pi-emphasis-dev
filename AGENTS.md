# AGENTS.md

Pi extension (pills, label icons, reply-style rules). `index.ts` draws; `reader.ts` is the hand-written block and inline reader that must agree with pi's configured Markdown parser (pi-tui's marked setup); no marked at runtime.

- New worktrees have no `node_modules`: run `bun install --frozen-lockfile` before `bun run check`.
- When editing `reader.ts`: it exceeds the read tool's size limit; read it in line ranges and edit with exact replacements.
- When writing a link-breakage test: put `**x**` or `[[Done]]` inside the link. A lone `a__b` pairs with nothing and draws nothing, so it cannot fail.
- pi-tui facts the code relies on: the transformer reruns on the whole reply at most once per 16 ms frame (`node_modules/@earendil-works/pi-tui/dist/tui.js`); marked reads link text with brackets one level deep, so pi never links text that holds a `[[pill]]`; `cjkPunctuationRegex` is not exported, so `reader.ts` keeps a copy (`CJK_PUNCTUATION`) that must match `node_modules/@earendil-works/pi-tui/dist/utils.js`.
