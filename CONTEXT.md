# Context

Pi Emphasis changes how an assistant reply is drawn in Pi's terminal. It never changes what is stored, copied or exported.

## Glossary

- **Pill**: `[[Word]]` in a reply, drawn as a chip. Its tone and icon come from its word.
- **Word**: the known term a pill starts with, such as Done or Needs you. Matching ignores case and extra spaces.
- **Detail**: text after the word inside the same pill, such as the "12/12" in "Passed 12/12".
- **Tone**: the color group a word belongs to: error, ask, warning, success, danger, mode, owner, or neutral for any unknown word. Ask holds Needs you and Decision.
- **State pill**: a pill of tone ask, error, warning or success. Only state pills are counted.
- **Count line**: a line of one pill per state word with its count, drawn after the last block of a complete reply with 5 or more state pills of at least 2 words.
- **Fill**: how a tone fills its pill: panel (the tone color tinted into the theme's toolPendingBg), solid (the tone color as background) or text (no background).
- **Edges**: the ends of a pill: round (Powerline caps), half (half blocks) or sharp (a filled space).
- **Icon set**: filled or outline Material Design circles of one size, or none. Each word maps to an icon group, and the set gives each group its glyph.
- **Synonym**: a word that is displayed as another word, so one state always reads the same (Completed is shown as Done).
- **Label**: a `##` heading, or bold text that opens a line or list item, also after a kind-of-work pill. A known label takes an icon.
- **Lead-in**: a bold word ending in a colon that introduces the action a pill calls for, such as "Check:".
- **Settings**: the optional `emphasis` block of pi's settings.json, read once per session start.
- **Reply guidance**: the rules added to the system prompt as the `reply_style` section, in the terminal interface only.
- **Palette**: the colors built from the current Pi theme and the settings. It is rebuilt when the theme changes.
- **Block reader**: the part that reads a reply's Markdown lines the way pi's parser does. For each line it gives a kind (prose, heading, code or blank), the literal ranges (inline code, HTML comments, inline math) and whether the line is plain top-level text. It also gives the fallback place of the count line, for a reply that ends inside an open block. The drawing and the count line both use it, so a pill is counted exactly when it is drawn.

## Rules and where each lives

All rules live in `index.ts` and `reader.ts` and are tested in `test/` without Pi running: `emphasis.test.ts` (words, pills, labels), `look.test.ts` (colors, edges, icons, count line, settings), `reply-style.test.ts` (the prompt section and its words), `stream.test.ts` (the layout while a reply streams, through pi-tui rendering) and `properties.test.ts` (Hegel property tests). Tests cross two seams: the default export, loaded into a stand-in pi (`test/seam.ts`), and the block reader (`readMarkdown`, `countPlace`). `index.ts` exports only the default export and three test-only tables: `VOCABULARY`, `readSettings` and `DEFAULT_SETTINGS`.

- Which tone a word has, and which words exist: `VOCABULARY` (`core` are the defining words, `also` are accepted too), read by `toneOf`.
- Which icon a pill word has: `WORD_ICON` gives its group, `ICON_SETS` gives the group's glyph.
- Which words are synonyms: `SYNONYMS`.
- Which labels take an icon: `LABEL_ICONS`, applied by `withLabelIcon`.
- Which lead-in words take an icon after a pill: `ACTION_ICONS`.
- What the settings may hold and their defaults: `readSettings` and `DEFAULT_SETTINGS`; the README section "Settings" describes them for people.
- How a tone becomes escapes: `createPalette` reads concrete colors from pi's `theme.colors` and lets pi-tui write the escapes for the color mode; its own rules are `PANEL_MIX`, the contrast pick for solid pills and the fallback without RGB (256 colors, or a theme without panel colors).
- When and where the count line appears: `tally`, `COUNT_LINE_MIN`, `decorate` (after the last block), `endsOpen` and `countPlace` (in `reader.ts`, the place for a reply that ends inside an open block).
- What waits while a reply streams (an unfinished pill, bold or heading at the end): `heldFrom`, applied in `decorate`.
- What the agent is told: `REPLY_STYLE`, fixed text; `test/reply-style.test.ts` checks that each word it names is in the tables above.
- How a pill label splits into icon, word and detail: `splitLabel`.
- What is prose and what stays untouched (code in any container, inline code, HTML comments, top-level math, escaped markers, link metadata): the block reader, `readMarkdown` in `reader.ts`, shared by the drawing (`drawProse`, `drawHeading`) and the count line.

## Border

Pi hands the extension an assistant message's Markdown, whether the message is still streaming, the current theme and the merged settings. The extension returns Markdown with terminal color codes added. Before each run in the terminal interface, the extension also hands Pi the reply guidance as one prompt section. Nothing else crosses.
