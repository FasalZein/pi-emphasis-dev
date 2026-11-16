# Pi Emphasis

Replies you can scan. This [Pi](https://pi.dev/) extension turns `[[Done]]`, `[[Failed]]` and `[[Needs you]]` into colored pills with icons, gives headings and lead labels an icon from their word, and colors bold text, arrows and tree lines.

![A Pi reply about a failed deploy, with colored pills, icons and labels](screenshots/reply.png)

The reply above is an invented example about an imagined deploy. This is the same reply without the extension:

![The same reply as plain Markdown, with the pills shown as bracketed words](screenshots/without.png)

It changes only what is drawn. Stored messages, copied text and HTML exports keep the original Markdown. It calls no model and costs nothing to run.

## Requirements

| You need | Why | Without it |
|---|---|---|
| [Pi](https://github.com/earendil-works/pi) 1.5 or newer (checked on 1.5.0) | This is a Pi extension | It cannot be installed |
| A [Nerd Font](https://www.nerdfonts.com/) in your terminal | The icons and the rounded pill ends are Nerd Font symbols | You see empty boxes. Set `PI_EMPHASIS_PILL_ICONS=0` and `PI_EMPHASIS_ROUND_CAPS=0` for plain square chips |
| `git` | `pi install` clones this repository | The install fails |

Checked on macOS only.

## Install

```sh
pi install git:github.com/johnlindquist/pi-emphasis
```

Then run `/reload` in Pi, or start Pi again.

- Update: `pi update --extensions`
- Try once without installing: `pi -e git:github.com/johnlindquist/pi-emphasis`
- Remove: `pi remove git:github.com/johnlindquist/pi-emphasis`

## The rules come with it

An agent writes pills only when it is told how. In Pi's terminal interface the extension adds a `reply_style` section to the system prompt on every run, so there is nothing to paste into an `AGENTS.md`. The section tells the agent:

- which words to use for each color, and that every failure, ask and unchecked claim needs its pill
- to open a reply with the kind of work it understood, and to mark consequences and ownership
- to follow each attention pill with the action it calls for, such as the fastest check after `[[Unverified]]`
- to write labels as plain words, because the extension adds the icons

The word lists in that section are read from the same tables that color the pills, so the rules and the drawing cannot drift apart. It adds about 1,500 tokens to the prompt. Print, JSON and RPC runs do not get the section, since nothing there draws pills.

To keep the drawing and write your own rules, set `PI_EMPHASIS_GUIDANCE=0`.

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

Environment variables, read when Pi starts:

- `PI_EMPHASIS_COLOR`: theme color for bold text (default `mdLink`).
- `PI_EMPHASIS_ROUND_CAPS=0`: square chips, for fonts without Nerd Font symbols.
- `PI_EMPHASIS_PILL_ICONS=0`: no icons in pills or on labels.
- `PI_EMPHASIS_GUIDANCE=0`: do not add the reply-style rules to the prompt.

To add a word, an icon or a synonym, edit the tables at the top of [`index.ts`](index.ts). The rules are the `replyGuidance` function in the same file.

## Limits

- A bold span that continues onto a second source line is colored only on its first line.
- Pills take their soft colors from the Pi theme's panel colors. When the terminal reports no colors, Pi's system theme has none, so pills are drawn in reverse video.
- The solid pills use the terminal's own red, cyan and blue, so their exact shade follows your terminal theme.
- If bold looks no heavier than normal text, that is your terminal or font, not this extension. Some terminals draw normal text at a medium weight, which leaves little room for bold.

## Development

```sh
bun install
bun run check                # types and tests
python3 demo/shots.py        # redraw the demo replies in a real Pi session, as HTML to screenshot
```

`demo/` holds the two example replies. `sgr-sampler.sh` prints every terminal text style so you can see which ones your terminal draws.
