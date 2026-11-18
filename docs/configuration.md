# Configuration

The extension reads an optional `emphasis` block from pi's settings. Pi merges the global file `~/.pi/agent/settings.json` with the project file `.pi/settings.json`, and the extension reads the merged result. A field that is missing or not valid takes its default. A color name that the current pi theme does not know, such as `"teal"`, also takes its default: use `#rrggbb` for a color outside the theme. After you change the block, run `/reload` in pi.

## Example

This block sets every field to its default:

```json
{
  "emphasis": {
    "edges": "round",
    "icons": "filled",
    "labels": "mdLink",
    "colors": {
      "success": "success",
      "error": "error",
      "warning": "warning",
      "ask": "warning",
      "danger": "error",
      "mode": "accent",
      "owner": "customMessageLabel",
      "neutral": "text"
    },
    "fill": {
      "success": "panel",
      "error": "panel",
      "warning": "panel",
      "ask": "solid",
      "danger": "solid",
      "mode": "panel",
      "owner": "panel",
      "neutral": "panel"
    }
  }
}
```

You only write the fields that you change. For example, this block gives the pills square ends and outline icons:

```json
{ "emphasis": { "edges": "sharp", "icons": "outline" } }
```

## Fields

### edges

The shape of the two ends of a pill.

| Value | Ends | Width of each end |
|---|---|---|
| `round` (default) | Rounded Powerline caps | 1 cell |
| `half` | Square, from half-block characters | Half a cell |
| `sharp` | Square, one filled space | 1 cell |

A terminal draws whole cells. A rounded end narrower than one cell does not exist as a character, so `half` is square.

### icons

The icon in front of the pill word.

| Value | Icons |
|---|---|
| `filled` (default) | Solid Material Design circles |
| `outline` | The same circles, drawn as rings |
| `none` | No icons |

All icons of a set have the same size: in a Nerd Font Mono font, each one measures 599 × 600 font units and is centred on the height of a capital letter.

An en space (U+2002) follows each icon. Ghostty lets a Nerd Font icon draw over two cells when a space or an en space follows it, so with a non-Mono Nerd Font the icon is about as tall as the letters and the pill keeps its width. pi breaks lines only at a normal space, so the icon and its word stay on one line. Other terminals draw the en space as a normal one-cell space. In Ghostty, `adjust-icon-height` makes the icons taller still. The Material Design set has no circle with a dollar sign, so Costs money, Destructive, Irreversible and Unsafe share an octagon.

### labels

The color of bold text: lead labels such as **Result:**, lead-ins such as **Do:**, and other bold words. The value is a pi theme color name or `#rrggbb`. The default is `mdLink`, the theme's link color, which is blue in the tokyonight theme.

Other theme colors that work well for labels:

| Value | Color in tokyonight |
|---|---|
| `mdLink` (default) | Blue, the link color (upstream's label color too) |
| `mdListBullet` | Cyan, the list-bullet color |
| `thinkingMinimal` | Teal |
| `mdHeading` | Purple, the same as headings |
| `thinkingText` | Soft grey-blue |
| `text` | The body text color |

### colors

The color of each tone. A tone is the color group of a pill word. Each value is a pi theme color name or `#rrggbb`. A theme color name follows `/theme` changes; a hex color stays the same in every theme.

| Tone | Words | Default color |
|---|---|---|
| `success` | Done, Passed, Fixed, Observed, Live, Recommended, Keep | `success` |
| `error` | Failed, Blocked, Broken, Unsafe | `error` |
| `warning` | Unverified, Partial, Skipped, In progress, Pending, At risk | `warning` |
| `ask` | Needs you, Decision | `warning` |
| `danger` | Costs money, Destructive, Irreversible | `error` |
| `mode` | Brainstorm, Investigate, Preview, Implement, Qualify | `accent` |
| `owner` | Owned, Shared, Foreign | `customMessageLabel` |
| `neutral` | Any other word | `text` |

The README lists the extra words that each tone accepts.

### fill

How each tone fills its pill.

| Value | Look |
|---|---|
| `panel` | A dark panel, tinted with the tone color, with the word in the tone color |
| `solid` | The tone color as background, with dark or light text, whichever contrasts more |
| `text` | The word in the tone color, with no background and no ends |

By default, `ask` and `danger` are `solid` and the other tones are `panel`. That is how Needs you and Decision stand apart from status pills such as In progress, which share the yellow.

## How the colors are made

- **Panel.** The panel background is 22% of the tone color mixed with 78% of the theme color `toolPendingBg`. A pi theme has no color for the terminal background, and `toolPendingBg` is the nearest: in tokyonight it is the background color.
- **Solid.** The extension measures the contrast ratio (WCAG) of the theme colors `text` and `toolPendingBg` against the tone color, and uses the one with the higher ratio for the word.
- **Terminals without truecolor.** Panels use the theme's tool backgrounds, as upstream did, and solid pills use reverse video. A hex color maps to the nearest color of the xterm 256-color cube.

## What has no setting

- **The count line.** In a reply with 5 or more state pills (asks, wrong, open and settled words) of at least 2 different words, a line under the first paragraph shows one pill per word with its count. Asks come first. A reply that opens with a list gets the line above the list. The line waits until the reply is complete. A reply that already has a line of only pills gets no count line.
- **The rules.** The `reply_style` prompt section is the `REPLY_STYLE` constant in [`index.ts`](../index.ts).
- **Words, synonyms and icons.** Edit the tables at the top of [`index.ts`](../index.ts).
