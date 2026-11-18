# DESIGN: pi-emphasis reply style (terminal)
Direction: calm and scannable: one pill family of the same size, inline after its subject, asks in solid yellow; the model writes the shape, the renderer draws everything it can know.
Tree:
- renderer / layout -> pills inline after the subject, "**Subject** [[Pill]] text" (round 2, 2026-11-18)
- renderer / palette -> tinted panels taken from the current pi theme (round 2 sheet, 2026-11-18)
- renderer / edges -> round: Powerline caps, 1 cell, no space inside (round 5, 2026-11-18)
- renderer / edges setting -> round | half (half blocks, 1/2 cell, square) | sharp (square, 1 cell of fill) (round 5 and 6, 2026-11-18)
- renderer / icons -> filled Material Design circle set; setting filled | outline | none (round 3 and 6, 2026-11-18)
- renderer / icon size -> an en space (U+2002) between icon and word: Ghostty then draws the icon over two cells, about the height of the letters, in the same pill width; pi keeps icon and word on one line (round 11, 2026-11-18)
- renderer / asks -> Needs you and Decision have their own tone "ask", solid yellow (round 6, 2026-11-18)
- renderer / count line -> one pill per word under the first paragraph, 5 or more state pills, asks first (round 6, 2026-11-18)
- renderer / labels and lead-ins -> icons as before (round 6); color blue, theme mdLink, as the default; setting `labels` with any theme color or hex; the owner's own settings use cyan, mdListBullet (round 9 and after, 2026-11-18)
- renderer / closing line of asks -> none (rules round, 2026-11-18)
- renderer / colors setting -> per tone: a pi theme color name or "#rrggbb"; fill per tone: panel | solid | text (round 6, 2026-11-18)
- rules -> c3, 358 prompt tokens on cpa/claude-opus-5-5 (rules round, 2026-11-18)
- terminal font -> Ghostty font-family "MonaspiceNe Nerd Font" (owner's config, outside this repository)
Tokens:
- Tones: success (theme success), error (theme error), warning (theme warning), ask (theme warning), danger (theme error), mode (theme accent), owner (theme customMessageLabel), neutral (theme selectedBg + text).
- Panel fill: the tone color mixed 22% into the theme's toolPendingBg; label in the tone color, bold. Solid fill: the tone color as background; label in whichever of toolPendingBg or text contrasts more with it.
- Default fill: panel for every tone, solid for ask and danger.
- 256-color terminals: theme tokens as before (panel = the tone's tool background, solid = reverse video); hex colors map to the nearest xterm-256 color.
- Pills next to each other are separated by two spaces.
Type: the terminal's font; the extension cannot change size or face. Icons are Nerd Font Material Design glyphs that all measure 599x600 units in a Nerd Font Mono cell, centred on the cap height.
Layout: inline. The count line sits after the first paragraph, as its own paragraph.
Components:
- Pill: [edge] [icon] [en space] [word or word + detail] [edge]. No-break spaces inside the word.
- Icon sets (filled / outline): settled check-circle, failed close-circle, blocked minus-circle, consequence alert-octagon, needs you account-circle, decision help-circle, unverified dots-circle, in progress play-circle, pending clock, partial half-circle, skipped skip-next-circle, at risk alert-circle; kinds of work: lightbulb, magnify, eye-circle, code-braces, checkbox-circle.
- Count line: one pill per state word with its count, order ask, error, warning, success.
States:
- Streaming: no count line until the reply is complete (the line would move the text below it).
- A reply that already holds a line of only pills (a written scoreboard): no count line.
- Code (fenced, also in quotes and lists; indented; inline), HTML comments and escaped markers: untouched, and their pills are neither drawn nor counted. Where the reader is not sure a line is prose, it treats it as code.
- A "$" before a digit in prose and headings is escaped for pi's Markdown, which would read it as the start of LaTeX math; inline code and valid math such as $2^3$ stay as written.
- The count line counts the pills that are drawn. It goes after a first paragraph or heading closed by a blank line, otherwise above the first line (a reply that opens with a list takes it above the list), so it never splits a list or enters code. It is per text block of a message, because pi transforms each block on its own.
- A setting that names a color the pi theme does not know falls back to that field's default.
Copy (the reply_style section, c3):
  The terminal draws [[Word]] as a colored pill and gives a bold lead label an icon.
  - Open with a bold label: **Result:** ... When the reply has several subjects, put a kind-of-work pill first: [[Implement]] **Result:** ... Kinds: Brainstorm, Investigate, Preview, Implement, Qualify.
  - Long reply: a ## heading per group; each bullet **Subject** [[Pill]] text.
  - Pills: [[Done]] [[Passed]] [[Fixed]] [[Observed]] [[Recommended]] [[Failed]] [[Blocked]] [[Partial]] [[In progress]] [[Unverified]] [[At risk]] [[Needs you]] [[Decision]] [[Destructive]] [[Costs money]] [[Shared]].
  - After a pill, the step that resolves it, led by a bold Do:, Check:, Next:, Unblock:, Left:, Guard:, Undo: or See:.
  - Keep pills out of code, paths and commands.
Settings (pi settings.json, all optional):
  "emphasis": { "edges": "round", "icons": "filled", "labels": "mdLink", "colors": { "<tone>": "<theme color or #rrggbb>" }, "fill": { "<tone>": "panel|solid|text" } }
Open for the build: none
References: none (no DMD run)
