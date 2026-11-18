# Pi Emphasis

## This fork

This is a fork of [pi-emphasis](https://github.com/johnlindquist/pi-emphasis) by John Lindquist, at commit `f884b73`. The drawing (pills, colors, icons, labels, lead-ins) is upstream's. It differs in two ways:

- **Compact rules.** The `reply_style` prompt section is a short tested rule set of about 290 tokens, in place of upstream's long guidance of about 2,400 tokens. It teaches 9 labels, 11 pill words and 5 lead-ins. The rules are the `REPLY_STYLE` constant in [`index.ts`](index.ts).
- **No switches.** The four `PI_EMPHASIS_*` environment variables are gone. The rules are always on in the terminal interface, pills have rounded ends and icons, and bold takes the `mdLink` color.

Sync with upstream: the remote `upstream` points at the original repository.

```sh
git fetch upstream
git merge upstream/main
bun run check
```

Merge conflicts usually sit in the guidance and the switches; keep this fork's side there. The rest of this README is upstream's, corrected where the fork makes it false.

Replies you can scan. This [Pi](https://pi.dev/) extension turns `[[Done]]`, `[[Failed]]` and `[[Needs you]]` into colored pills with icons, gives headings and lead labels an icon from their word, and colors bold text, arrows and tree lines.

![A Pi reply about a failed deploy, with colored pills, icons and labels](screenshots/reply.png)

The reply above is an invented example about an imagined deploy. This is the same reply without the extension:

![The same reply as plain Markdown, with the pills shown as bracketed words](screenshots/without.png)

It changes only what is drawn. Stored messages, copied text and HTML exports keep the original Markdown. It calls no model and costs nothing to run.

## Requirements

| You need | Why | Without it |
|---|---|---|
| [Pi](https://github.com/earendil-works/pi) 1.5 or newer (checked on 1.5.0) | This is a Pi extension | It cannot be installed |
| A terminal that can draw [Nerd Font](https://www.nerdfonts.com/) symbols | The icons and the rounded pill ends are Nerd Font symbols | You see empty boxes or question marks. See [Set up your terminal](#set-up-your-terminal) |
| A terminal with color | Pills are colored backgrounds | Pills are drawn in reverse video, all in one color |
| `git` | `pi install` clones this repository | The install fails |

Checked on macOS only. Setup takes about two minutes if your terminal already has the symbols.

## Install

This fork has no public address. Install it from its local path:

```sh
pi install /path/to/pi-emphasis
```

Then run `/reload` in Pi, or start Pi again.

- Update: `git pull` in the fork, then `/reload`
- Try once without installing: `pi -e /path/to/pi-emphasis`
- Remove: `pi remove /path/to/pi-emphasis`

## Set up your terminal

**1. Check whether your terminal already draws the symbols.** Paste this into your shell:

```sh
printf '\ue0b6\uf00c \uf128 \uf007\ue0b4\n'
```

You should see a half circle, a check mark, a question mark, a person and another half circle. If you do, skip to step 3. Ghostty, kitty and WezTerm include these symbols, so they usually pass with any font.

**2. If you see boxes, install a Nerd Font and select it.** On macOS with Homebrew:

```sh
brew install --cask font-jetbrains-mono-nerd-font
```

Or download any family from [nerdfonts.com](https://www.nerdfonts.com/font-downloads). Then choose it as the terminal's font and run the check again:

| Terminal | Where the font is set |
|---|---|
| iTerm2 | Settings, Profiles, Text, Font |
| macOS Terminal | Settings, Profiles, Text, Font |
| VS Code terminal | the `terminal.integrated.fontFamily` setting, for example `JetBrainsMono Nerd Font` |
| Alacritty | `font.normal.family` in `alacritty.toml` |

To keep your current font, install only the symbols with `brew install --cask font-symbols-only-nerd-font` and add "Symbols Nerd Font" as a fallback font where your terminal supports one.

**3. Check it in Pi.** After installing the extension and running `/reload`, ask:

> Reply with one line that uses the pills [[Done]], [[Needs you]], [[Failed]] and [[Costs money]].

You should see four rounded pills in green, yellow, soft red and solid red, each with an icon.

**No Nerd Font?** This fork always draws icons and rounded ends; it has no switch to turn them off. Install a Nerd Font or the symbols-only font above.

## The rules come with it

An agent writes pills only when it is told how. In Pi's terminal interface the extension adds a `reply_style` section to the system prompt on every run, so there is nothing to paste into an `AGENTS.md`. The section tells the agent:

- to open every reply, and each subject of a long reply, with a bold label: Result, Status, Cause, Fix, Risk, Next, Plan, Evidence, Decision
- to put a pill beside the subject whose state it names, with only these words: Done, Passed, Fixed, Failed, Blocked, In progress, Unverified, Needs you, Decision, Destructive, Costs money
- to follow every pill except Done, Passed and Fixed with the one step that resolves it, led by a bold Do:, Check:, Next:, Unblock: or Undo:
- to keep pills out of code, paths and commands

The section is fixed text. A test checks that every label, pill word and lead-in it names gets its color and icon, so the rules and the drawing cannot drift apart. It adds about 290 tokens to the prompt. Print, JSON and RPC runs do not get the section, since nothing there draws pills.

## Pills

Write `[[Word]]` beside the thing it describes. The word decides the color and the icon.

![Every pill word, grouped by color](screenshots/vocabulary.png)

| Color | Meaning | Words |
|---|---|---|
| Red | Something is wrong | Failed, Blocked, Broken, Unsafe, Rejected, Down |
| Yellow | Look here | Needs you, Decision, Unverified, Partial, Skipped, In progress, Pending, At risk, Review, Todo, Stale, Draft |
| Green | Settled | Done, Passed, Observed, Fixed, Live, Recommended, Keep, Ready, Merged, Safe, Verified, Shipped, Approved, Healthy |
| Solid red | Consequences | Costs money, Destructive, Irreversible |
| Cyan | Kind of work | Brainstorm, Investigate, Preview, Implement, Qualify |
| Solid blue | Ownership | Owned, Shared, Foreign |
| Soft blue | Context | Inferred, New, Changed, Optional, and any other label |

- **Detail.** A known word may be followed by detail: `[[Passed 12/12]]`, `[[Failed: 3 tests]]`, `[[In progress 40%]]`.
- **Synonyms.** Completed, Complete, OK and Finished display as Done. Fail, Failing and Error display as Failed. Pass displays as Passed, Waiting as Pending, and Needs review as Review.
- **Your own icon.** A label that starts with a Nerd Font glyph keeps that glyph.
- **Length.** A label can be up to 32 characters. Longer ones are left as typed.

## Labels and shapes

- **Headings and lead labels.** A `##` heading, or bold text at the start of a line or list item, takes an icon when it is one of: Finding, Result, Status, Evidence, Cause, Effect, Fix, Risk, Limits, Cost, Decision, Options, Plan, Next, Why, How, Rule, Example, Checked, Verdict, Rollback, Undo, Review, Scoreboard, Terminal, Folder, File, Branch, Ideas, Pills, Colors, Icons. A trailing colon is fine.
- **Action lead-ins.** Bold **Check:**, **Do:**, **Next:**, **Unblock:**, **Left:**, **Run:**, **Guard:**, **Undo:** and **See:** take an icon anywhere in a line, so the action that follows a pill is easy to find: `[[Unverified]] the red pills on your screen. **Check:** run /reload.` The colon is required.
- **Bold.** `**anchor term**` keeps its weight and takes the theme's link color.
- **Marks.** `✓` takes the success color, `✗` the error color, and `→` the accent color.
- **Trees.** `├──` and `└──` are dimmed so the content stands out.

Your own messages, inline code, fenced code and escaped asterisks are left alone.

## Settings

This fork has no settings. Bold takes the theme's `mdLink` color, pills have rounded ends and icons, and the rules are always added in the terminal interface.

To add a word, an icon or a synonym, edit the tables at the top of [`index.ts`](index.ts). The rules are the `REPLY_STYLE` constant in the same file.

## Troubleshooting

| You see | Cause | Fix |
|---|---|---|
| `[[Done]]` as plain text | The extension is not loaded | Run `/reload`. Check that `pi list` shows pi-emphasis |
| Boxes or question marks in or around pills | The terminal has no Nerd Font symbols | [Set up your terminal](#set-up-your-terminal) |
| Icons that overlap the next letter | The font draws its icons two cells wide | Use the "Mono" variant of the Nerd Font, such as JetBrainsMono Nerd Font Mono |
| Pills that are all one color, in reverse video | Pi's theme has no panel colors, which happens with the `system` theme when the terminal reports none | Choose a theme with `/theme`, such as `dark` |
| Solid red, cyan or blue pills in odd shades | Those three use your terminal's own colors | Change the terminal's color theme |
| Bold that looks no heavier than normal text | The terminal draws normal text at a medium weight, or its font has no real bold | Choose a font with a distinct bold. In Ghostty, `font-style-bold` selects a heavier face |
| The agent writes no pills | The rules reach the agent only in Pi's terminal interface | Use the terminal interface. Print, JSON and RPC runs never get the rules |
| Pills inside code blocks stay as typed | Code is left alone on purpose | Nothing to fix |

## Limits

- A bold span that continues onto a second source line is colored only on its first line.
- Checked on macOS only, in Ghostty and the Herdr app.

## Development

```sh
bun install
bun run check                # types and tests
python3 demo/shots.py        # redraw the demo replies in a real Pi session, as HTML to screenshot
```

`demo/` holds the two example replies. `sgr-sampler.sh` prints every terminal text style so you can see which ones your terminal draws.
