// pi-emphasis: display-only emphasis for assistant replies in Pi's terminal.
//
//   **anchor term**   bold keeps its weight and takes a theme color (the link color, blue, by default)
//   ✓ / ✗             take the success and error colors
//   [[Blocked]]       becomes a status pill colored by its word, with that word's icon
//
// Stored messages, copied text, and HTML exports keep the original Markdown.
// In the terminal interface it also adds a reply_style section to the system prompt, telling the
// model how to write these.
//
// Fork of https://github.com/johnlindquist/pi-emphasis at commit f884b73 (see README.md, "This fork").
// The design of this fork's look and rules is DESIGN.md; every setting is in the README section "Settings".
// Changes against upstream:
//   - The prompt section is the compact tested text REPLY_STYLE (310 tokens against 2,419 for
//     upstream's replyGuidance()).
//   - Needs you and Decision have their own tone, "ask", drawn solid.
//   - Pill colors are tinted panels taken from the current pi theme; icons are one family of
//     same-size Material Design circles; a count line of the reply's pills is drawn after the
//     last block.
//   - The PI_EMPHASIS_* environment switches are gone. An optional "emphasis" block in pi's
//     settings.json sets edges, icons, label color, tone colors and fill (readSettings()).
import type { ExtensionAPI, Theme, ThemeBg, ThemeColor, ThemeToken } from "@earendil-works/pi-coding-agent";
import { backgroundAnsi, type Color, colorToRgb, foregroundAnsi, mixColors, parseColor, type RgbColorValue, rgbColor } from "@earendil-works/pi-tui";
import { CJK_CHAR, countPlace, type EndState, mayDefine, opensLeft, type Range, type ReadLine, readBlocks, readMarkdown, runKind, strongPairs } from "./reader.ts";

type Colorize = (text: string) => string;
type PillTone = "success" | "error" | "warning" | "ask" | "danger" | "mode" | "owner" | "neutral";
type Edges = "round" | "half" | "sharp";
type IconSet = "filled" | "outline" | "none";
type Fill = "panel" | "solid" | "text";

/** The optional "emphasis" block of pi's settings.json. The README section "Settings" describes each field. */
interface EmphasisSettings {
	edges: Edges;
	icons: IconSet;
	/** Color of bold labels, lead-ins and bold text: a pi theme color name or "#rrggbb". */
	labels: string;
	/** Per tone: a pi theme color name or "#rrggbb". */
	colors: Record<PillTone, string>;
	fill: Record<PillTone, Fill>;
}

const TONES: PillTone[] = ["success", "error", "warning", "ask", "danger", "mode", "owner", "neutral"];
// Test-only export: the defaults table, the expected value of every missing or invalid settings field
// in test/properties.test.ts.
export const DEFAULT_SETTINGS: EmphasisSettings = {
	edges: "round",
	icons: "filled",
	labels: "mdLink",
	colors: { success: "success", error: "error", warning: "warning", ask: "warning", danger: "error", mode: "accent", owner: "customMessageLabel", neutral: "text" },
	fill: { success: "panel", error: "panel", warning: "panel", ask: "solid", danger: "solid", mode: "panel", owner: "panel", neutral: "panel" },
};

const COLOR_SPEC = /^(#[0-9a-fA-F]{6}|[A-Za-z][A-Za-z0-9]*)$/;
const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
	typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
const color = (value: unknown, fallback: string) => (typeof value === "string" && COLOR_SPEC.test(value) ? value : fallback);
const record = (value: unknown) => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

/** Reads the "emphasis" settings block. Missing or invalid fields take their default. */
// Test-only export: the drawing cannot tell some kept values apart ("#FF966C" and "#ff966c" draw the same
// color), so the per-field rule is checked here, in test/properties.test.ts and test/look.test.ts.
export function readSettings(raw: unknown): EmphasisSettings {
	const s = record(raw);
	const colors = record(s.colors);
	const fill = record(s.fill);
	const d = DEFAULT_SETTINGS;
	return {
		edges: pick(s.edges, ["round", "half", "sharp"], d.edges),
		icons: pick(s.icons, ["filled", "outline", "none"], d.icons),
		labels: color(s.labels, d.labels),
		colors: Object.fromEntries(TONES.map((t) => [t, color(colors[t], d.colors[t])])) as Record<PillTone, string>,
		fill: Object.fromEntries(TONES.map((t) => [t, pick(fill[t], ["panel", "solid", "text"], d.fill[t])])) as Record<PillTone, Fill>,
	};
}

interface PillStyle {
	/** Opening escapes of the pill's body. */
	label: string;
	/** Foreground escape that draws the edges in the body's color; empty for a pill without edges. */
	cap: string;
}

interface Palette {
	/** Wraps bold text in a color. */
	bold: Colorize;
	passed: Colorize;
	failed: Colorize;
	pills: Record<PillTone, PillStyle>;
	/** Colors for arrows and tree connectors. */
	arrow: Colorize;
	tree: Colorize;
	edges: Edges;
	/** The opening escape of pi's block quote color, restored after a pill or glyph in a quote. */
	quote: string;
	/** The glyph of each icon group; undefined draws no icons. */
	icons?: Record<string, string>;
}

/** Each tone's words. `core` are the words the tones were defined with; `also` are accepted and colored the same. */
// Test-only export: the word list is the tests' oracle for tones and the count line (test/emphasis.test.ts,
// test/properties.test.ts); the drawing shows a word's tone but not which words the list holds.
export const VOCABULARY: Record<Exclude<PillTone, "neutral">, { core: string[]; also: string[] }> = {
	error: { core: ["Failed", "Blocked", "Broken", "Unsafe"], also: ["fail", "failing", "error", "rejected", "down"] },
	ask: { core: ["Needs you", "Decision"], also: [] },
	warning: { core: ["Unverified", "Partial", "Skipped", "In progress", "Pending", "At risk"], also: ["needs review", "waiting", "review", "todo", "stale", "draft"] },
	success: { core: ["Done", "Passed", "Observed", "Fixed", "Live", "Recommended", "Keep"], also: ["pass", "ready", "merged", "safe", "verified", "shipped", "ok", "approved", "complete", "completed", "finished", "healthy"] },
	danger: { core: ["Costs money", "Destructive", "Irreversible"], also: [] },
	mode: { core: ["Brainstorm", "Investigate", "Preview", "Implement", "Qualify"], also: [] },
	owner: { core: ["Owned", "Shared", "Foreign"], also: [] },
};
const TONE_WORDS = Object.fromEntries(
	Object.entries(VOCABULARY).map(([tone, words]) => [tone, [...words.core, ...words.also].map((w) => w.toLowerCase())]),
) as Record<Exclude<PillTone, "neutral">, string[]>;

/**
 * Icon groups. Every glyph is a Nerd Font Material Design circle (or octagon) that measures 599x600
 * units in a Nerd Font Mono cell, centred on the cap height, so all pill icons have one size.
 */
const ICON_SETS: Record<Exclude<IconSet, "none">, Record<string, string>> = {
	filled: {
		settled: "\u{f05e0}", wrong: "\u{f0159}", blocked: "\u{f0376}", stop: "\u{f0029}", you: "\u{f0009}", decision: "\u{f02d7}",
		unknown: "\u{f07c3}", progress: "\u{f040c}", pending: "\u{f0954}", partial: "\u{f1396}", skipped: "\u{f0661}", risk: "\u{f0028}",
		pick: "\u{f04cf}", info: "\u{f02fc}", added: "\u{f0417}", edited: "\u{f06ff}", open: "\u{f0130}", stale: "\u{f0955}", shared: "\u{f1978}", other: "\u{f073a}",
		brainstorm: "\u{f06e8}", investigate: "\u{f0349}", preview: "\u{f0b94}", implement: "\u{f0169}", qualify: "\u{f0133}",
	},
	outline: {
		settled: "\u{f05e1}", wrong: "\u{f015a}", blocked: "\u{f0377}", stop: "\u{f0ce6}", you: "\u{f0b55}", decision: "\u{f0625}",
		unknown: "\u{f0b8d}", progress: "\u{f040d}", pending: "\u{f0150}", partial: "\u{f1396}", skipped: "\u{f0662}", risk: "\u{f05d6}",
		pick: "\u{f09a4}", info: "\u{f02fd}", added: "\u{f0419}", edited: "\u{f0776}", open: "\u{f0130}", stale: "\u{f05ce}", shared: "\u{f1978}", other: "\u{f073a}",
		brainstorm: "\u{f06e9}", investigate: "\u{f0349}", preview: "\u{f0b95}", implement: "\u{f0169}", qualify: "\u{f0134}",
	},
};
/** The icon group of each known pill word. Words without an entry stay text-only. */
const WORD_ICON: Record<string, string> = {
	done: "settled", passed: "settled", pass: "settled", complete: "settled", completed: "settled", ok: "settled", verified: "settled",
	observed: "settled", fixed: "settled", live: "settled", shipped: "settled", approved: "settled", ready: "settled", merged: "settled",
	healthy: "settled", safe: "settled", keep: "settled", recommended: "pick",
	failed: "wrong", fail: "wrong", failing: "wrong", error: "wrong", rejected: "wrong", broken: "wrong", down: "wrong",
	blocked: "blocked", unsafe: "stop", "costs money": "stop", destructive: "stop", irreversible: "stop",
	"needs you": "you", owned: "you", decision: "decision", unverified: "unknown", "at risk": "risk",
	"in progress": "progress", pending: "pending", waiting: "pending", partial: "partial", skipped: "skipped",
	review: "preview", stale: "stale", draft: "edited", todo: "open", optional: "open", inferred: "info", new: "added", changed: "edited",
	shared: "shared", foreign: "other",
	brainstorm: "brainstorm", investigate: "investigate", preview: "preview", implement: "implement", qualify: "qualify",
};

/** Words that display as one canonical word, so the same state always reads the same. */
const SYNONYMS: Record<string, string> = {
	complete: "Done", completed: "Done", ok: "Done", finished: "Done", pass: "Passed",
	fail: "Failed", failing: "Failed", error: "Failed", waiting: "Pending", "needs review": "Review",
};

/** The icon a heading or a line's leading bold label takes from its word. */
const LABEL_ICONS: Record<string, string> = {
	finding: "\uf002", terminal: "\uf120", folder: "\uf07b", file: "\uf15b", branch: "\uf126", review: "\uf06e",
	ideas: "\uf0eb", cause: "\uf0e7", fix: "\uf0ad", risk: "\uf071", limits: "\uf071", next: "\uf061", rollback: "\uf0e2",
	undo: "\uf0e2", options: "\uf0ca", result: "\uf11e", why: "\uf059", how: "\uf013", cost: "\uf155", rule: "\uf0e3",
	example: "\uf121", checked: "\uf00c", pills: "\uf02b", colors: "\uf1fc", icons: "\uf005", scoreboard: "\uf080",
	verdict: "\uf0e3", effect: "\uf140", evidence: "\uf06e", plan: "\uf0ae", status: "\uf012", decision: "\uf126",
};

/** A table entry for a key from reply text; inherited members such as "constructor" are not entries. */
const own = <T>(table: Record<string, T>, key: string): T | undefined => (Object.hasOwn(table, key) ? table[key] : undefined);

// A label may open with its own Private Use Area glyph, which wins over the table's icon.
const OWN_ICON = /^\s*([\ue000-\uf8ff]|[\u{f0000}-\u{ffffd}])\s*/u;

const KNOWN = [...new Set([...Object.values(TONE_WORDS).flat(), ...Object.keys(WORD_ICON), ...Object.keys(SYNONYMS)])].sort((a, b) => b.length - a.length);

type SplitLabel = { icon: string | undefined; word: string; key: string };
/**
 * A copy of text that shares no memory with it. A slice of a reply (a line, a label) keeps the whole reply
 * alive in V8 and JavaScriptCore; whatever outlives the call (the streaming cache, the memos) is detached first.
 * The JSON round trip keeps every UTF-16 code unit, lone surrogates included.
 */
const detach = (text: string): string => JSON.parse(JSON.stringify(text)) as string;

/**
 * Memo of splitLabel per icon table (undefined: no icons; three tables at most), since a reply draws, tones and
 * counts the same few labels many times. Keys are detached labels of at most 32 UTF-16 units (the pill
 * pattern), and each memo is cleared when it reaches LABEL_MEMO_MAX entries, so one memo keeps at most 512 short
 * strings and their split. 512 is enough for one reply: the corpus reply with the most pills (every pill word)
 * has 41 distinct labels, the others 16 or fewer; a reply with more only rebuilds the memo, with the same output.
 */
const LABEL_MEMO_MAX = 512;
const labelMemo = new Map<Record<string, string> | undefined, Map<string, SplitLabel>>();
function splitLabel(label: string, icons?: Record<string, string>): SplitLabel {
	let memo = labelMemo.get(icons);
	if (!memo) labelMemo.set(icons, (memo = new Map()));
	let split = memo.get(label);
	if (!split) {
		if (memo.size >= LABEL_MEMO_MAX) memo.clear();
		const key = detach(label);
		memo.set(key, (split = readLabel(key, icons)));
	}
	return split;
}

/** A pill label read as its word: a known word may be followed by detail ("Passed 12/12", "Failed: 3 tests"). */
function readLabel(label: string, icons?: Record<string, string>): SplitLabel {
	const ownGlyph = label.match(OWN_ICON);
	const text = (ownGlyph ? label.slice(ownGlyph[0].length) : label).replace(/\s+/g, " ").trim();
	const lower = text.toLowerCase();
	const known = KNOWN.find((k) => lower === k || (lower.startsWith(k) && /[ :]/.test(lower[k.length])));
	const canonical = known ? own(SYNONYMS, known) : undefined;
	const key = (canonical ?? known ?? lower).toLowerCase();
	const word = canonical && known ? canonical + text.slice(known.length) : text;
	const group = own(WORD_ICON, key) ?? (known ? own(WORD_ICON, known) : undefined);
	return { icon: ownGlyph?.[1] ?? (icons && group ? own(icons, group) : undefined), word, key };
}

/** The tone of each word: the first tone in this order whose words hold it. */
const TONE_OF_KEY = new Map<string, PillTone>();
for (const tone of ["danger", "error", "ask", "warning", "success", "mode", "owner"] as const) {
	for (const word of TONE_WORDS[tone]) if (!TONE_OF_KEY.has(word)) TONE_OF_KEY.set(word, tone);
}
function toneOf(label: string): PillTone {
	return TONE_OF_KEY.get(splitLabel(label).key) ?? "neutral";
}

/** The share of the tone color in a panel's background; the rest is the theme's toolPendingBg. */
const PANEL_MIX = 0.22;
/** WCAG relative luminance and contrast ratio, to pick readable text on a solid pill. */
const luminance = (c: RgbColorValue) => {
	const [r, g, b] = [c.r, c.g, c.b].map((v) => {
		const s = v / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: RgbColorValue, b: RgbColorValue) => {
	const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
	return (x + 0.05) / (y + 0.05);
};
/** The opening truecolor escape pi-tui writes for a color (colorAnsi in pi-tui's colors.js). */
const TRUECOLOR_ESCAPE = /^\x1b\[(?:38|48);2;(\d+);(\d+);(\d+)m/;
/** A color as whole sRGB channels, the values pi writes into a truecolor escape. */
const whole = (c: Color): RgbColorValue => {
	const { r, g, b } = colorToRgb(c);
	return rgbColor(Math.round(r), Math.round(g), Math.round(b));
};

// Tool backgrounds for terminals without truecolor, as upstream drew them.
const LEGACY_BG: Record<PillTone, ThemeBg> = {
	success: "toolSuccessBg", error: "toolErrorBg", warning: "searchMatchBg", ask: "searchMatchBg", danger: "toolErrorBg", mode: "selectedBg", owner: "selectedBg", neutral: "selectedBg",
};

function createPalette(theme: Theme, settings: EmphasisSettings): Palette {
	const mode = theme.getColorMode();
	const truecolor = mode === "truecolor";
	const colors = theme.colors;
	// Pi's theme throws on a color name it does not know ("teal"); such a setting falls back to its default.
	const known = (name: string) => {
		try {
			theme.getFgAnsi(name as ThemeColor);
			return true;
		} catch {
			return false;
		}
	};
	const valid = (spec: string, fallback: string) => (spec.startsWith("#") || known(spec) ? spec : fallback);
	settings = {
		...settings,
		labels: valid(settings.labels, DEFAULT_SETTINGS.labels),
		colors: Object.fromEntries(TONES.map((t) => [t, valid(settings.colors[t], DEFAULT_SETTINGS.colors[t])])) as Record<PillTone, string>,
	};
	const fg = (name: string) => (text: string) => theme.fg(name as ThemeColor, text);
	const fgOf = (spec: string) => (spec.startsWith("#") ? foregroundAnsi(parseColor(spec), mode) : theme.getFgAnsi(spec as ThemeColor));
	/**
	 * The color a token's own escape draws. theme.colors is that color for most tokens, but pi normalizes some:
	 * a token set to "" (terminal default) gets a guessed color, and a faint token a mix toward the background
	 * while its escape keeps the original color plus SGR 2. The escape decides: when theme.colors does not open
	 * it, the color is the truecolor RGB the escape names, and none for a default or indexed escape.
	 */
	const ownColor = (token: string, slot: "fg" | "bg"): Color | undefined => {
		const escape = slot === "fg" ? theme.getFgAnsi(token as ThemeColor) : theme.getBgAnsi(token as ThemeBg);
		const c = colors[token as ThemeToken];
		if (c && escape.startsWith(slot === "fg" ? foregroundAnsi(c, mode) : backgroundAnsi(c, mode))) return c;
		const rgb = TRUECOLOR_ESCAPE.exec(escape);
		return rgb ? rgbColor(Number(rgb[1]), Number(rgb[2]), Number(rgb[3])) : undefined;
	};
	/**
	 * A color spec as RGB, when the terminal draws truecolor and the theme gives one. An indexed theme color
	 * has no RGB of its own (the terminal's palette decides), so it takes the path without RGB.
	 */
	const rgb = (spec: string, slot: "fg" | "bg" = "fg"): RgbColorValue | undefined => {
		if (!truecolor) return undefined;
		const c = spec.startsWith("#") ? parseColor(spec) : ownColor(spec, slot);
		return c && c.kind !== "indexed" ? whole(c) : undefined;
	};
	const base = rgb("toolPendingBg", "bg");
	const text = rgb("text");

	const style = (tone: PillTone): PillStyle => {
		const spec = settings.colors[tone];
		const fill = settings.fill[tone];
		if (fill === "text") return { label: fgOf(spec), cap: "" };
		const c = rgb(spec);
		if (c && base) {
			if (fill === "solid") {
				const ink = text && contrast(text, c) > contrast(base, c) ? text : base;
				return { label: backgroundAnsi(c, mode) + foregroundAnsi(ink, mode), cap: foregroundAnsi(c, mode) };
			}
			const p = mixColors(base, c, PANEL_MIX, "srgb");
			return { label: backgroundAnsi(p, mode) + foregroundAnsi(c, mode), cap: foregroundAnsi(p, mode) };
		}
		// No RGB (a 256-color terminal, or a theme without panel colors): solid pills, and panels in
		// a theme without its own panel colors, draw in reverse video with the tone's color as background.
		const legacy = ownColor(LEGACY_BG[tone], "bg");
		if (fill === "solid" || !legacy) {
			const f = fgOf(tone === "neutral" && spec === "text" ? "accent" : spec);
			return { label: f + "\x1b[7m", cap: f };
		}
		return { label: theme.getBgAnsi(LEGACY_BG[tone]) + fgOf(spec), cap: foregroundAnsi(legacy, mode) };
	};
	return {
		bold: settings.labels.startsWith("#") ? (t: string) => fgOf(settings.labels) + t + "\x1b[39m" : fg(settings.labels),
		passed: fg("success"),
		failed: fg("error"),
		pills: Object.fromEntries(TONES.map((t) => [t, style(t)])) as Record<PillTone, PillStyle>,
		arrow: fg("accent"),
		tree: fg("dim"),
		edges: settings.edges,
		quote: theme.getFgAnsi("mdQuote"),
		icons: settings.icons === "none" ? undefined : ICON_SETS[settings.icons],
	};
}

// A [[pill]] of 1-32 characters. Neither bracket pair may be escaped (an odd backslash run before it):
// pi shows an escaped bracket as written.
const UNESCAPED = String.raw`(?<=(?:^|[^\\])(?:\\\\)*)`;
const PILL = String.raw`${UNESCAPED}\[\[([^\[\]\n]{1,32})${UNESCAPED}\]\]`;
const PILL_SKIP = String.raw`${UNESCAPED}\[\[[^\[\]\n]{1,32}${UNESCAPED}\]\]`;
// Escaped bold markers, bold markers, or a pill. A backslash run is read from its start only, so a long
// run without a marker costs time linear in its length.
const INLINE = new RegExp(String.raw`(?<!\\)(\\*)(\*\*|__)|` + PILL, "g");
// INLINE, then the glyphs that take a color: checks, crosses, arrows and tree connectors.
const INLINE_OR_GLYPH = new RegExp(INLINE.source + "|([✓✔])|([✗✘])|(→)|([├└]──)", "g");
// A written scoreboard: a line of two or more pills and nothing else.
const PILLS_ONLY = new RegExp(String.raw`^\s*${PILL_SKIP}(?:\s*${PILL_SKIP})+\s*$`);
/** The fewest state pills (ask, error, warning or success) a reply needs for a count line. */
const COUNT_LINE_MIN = 5;
const COUNT_ORDER: PillTone[] = ["ask", "error", "warning", "success"];
const DISPLAY = Object.fromEntries(
	Object.values(VOCABULARY)
		.flatMap((w) => [...w.core, ...w.also])
		.map((w) => [w.toLowerCase(), w[0].toUpperCase() + w.slice(1)]),
);

/** The count line of drawn pill labels: one pill per state word with its count, asks first. */
function tally(labels: string[]): string | undefined {
	const counts = new Map<string, number>();
	let total = 0;
	for (const label of labels) {
		if (!COUNT_ORDER.includes(toneOf(label))) continue;
		const { key } = splitLabel(label);
		counts.set(key, (counts.get(key) ?? 0) + 1);
		total++;
	}
	if (total < COUNT_LINE_MIN || counts.size < 2) return undefined;
	return [...counts.keys()]
		.sort((a, b) => COUNT_ORDER.indexOf(toneOf(a)) - COUNT_ORDER.indexOf(toneOf(b)))
		.map((k) => "[[" + (own(DISPLAY, k) ?? k) + " " + counts.get(k) + "]]")
		.join(" ");
}

interface Drawing {
	lines: string[];
	/** The labels of the pills drawn, in order. */
	pills: string[];
	/** The reply holds a written scoreboard, a line of only pills. */
	scoreboard: boolean;
	/** The reading of each line. */
	read: ReadLine[];
	/** The last finished-block boundary (readBlocks), -1 for none. */
	boundary: number;
	/** The number of pills drawn and whether a scoreboard was seen in lines 0..boundary. */
	pillsAtBoundary: number;
	scoreboardAtBoundary: boolean;
	/** The reader's state after the last line. */
	end: EndState;
}

/**
 * The drawn finished blocks of the reply streaming now: the head text is the first `length` characters of the
 * reply, up to and including the line break after a finished-block boundary. One per extension instance; built
 * only by streaming calls, and reused only while the palette is the same and the reply starts with the head text.
 * It keeps no slice of an earlier reply: `source` is the reply of the latest call that used it, and the
 * drawing and pills are detached copies, so it holds one reply's head, not every frame's reply.
 */
interface Head {
	palette: Palette;
	source: string;
	length: number;
	/** The drawn lines of the head text, joined, plus the line break after them (detached pieces). */
	out: string;
	read: ReadLine[];
	/** Detached labels of the pills drawn in the head. */
	pills: string[];
	scoreboard: boolean;
}

/** The escapes that open and close bold color, per palette: a palette's colors do not change. */
const boldMemo = new WeakMap<Palette, [string, string]>();
const boldEnds = (palette: Palette) => {
	let ends = boldMemo.get(palette);
	if (!ends) boldMemo.set(palette, (ends = palette.bold("\u0000").split("\u0000") as [string, string]));
	return ends;
};

/** The drawn bold of one line: pi's parser pairs these delimiters, and the color around them leaves the pairing as it was. */
interface LinePlan {
	/** The start in the line of each drawn "**" or "__" delimiter: it opens or closes the bold color. */
	marks: Map<number, "open" | "close">;
	/** The line starts inside a drawn bold span that an earlier line of its paragraph opened. */
	continued: boolean;
	/** The INLINE matches of each part of the line as written (partsOf; none for a literal part), when boldPlans read them. */
	inline?: (RegExpExecArray[] | undefined)[];
}

/** A character that keeps its class next to a color escape: not a space, punctuation, symbol or CJK. */
const PLAIN_CHAR = /^[^\s\p{P}\p{S}]/u;
const plainChar = (c: string) => c !== "" && PLAIN_CHAR.test(c) && !CJK_CHAR.test(c);
const charAt = (text: string, at: number) => (at < text.length ? String.fromCodePoint(text.codePointAt(at)!) : "");
const charBefore = (text: string, at: number) => {
	if (at <= 0) return "";
	const low = text.charCodeAt(at - 1);
	return at >= 2 && low >= 0xdc00 && low <= 0xdfff ? text.slice(at - 2, at) : text[at - 1];
};
const BOLD_RUN = /\*\*|__/;
/** A line that may open an HTML block (after quote and list markers): pi shows its text as written. */
const HTML_START = /^[ \t>]*(?:(?:[-*+]|\d+[.)])[ \t]+)*</;
/** A GFM table delimiter row (after quote and list markers): pi reads each cell alone, or the table raw when narrow. */
const TABLE_DELIMITER = /^[ \t>]*(?:(?:[-*+]|\d+[.)])[ \t]+)*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
/** A sign that may open math pi reads as pending to the end of the text: "$" not before a digit (the drawing escapes those), "\(" or "\[". */
const MATH_SIGN = /\$(?!\d)|\\[(\[]/g;
/** Text inside a span that ends in a bare URL or email address: a restore escape after it would join its link target. */
const LINK_TEXT = /:\/\/|www\.|@/i;
/** Characters after a literal range (inside a span) that the restore escape before them would change. */
const AFTER_LITERAL = "*_~\\";

/**
 * Which bold delimiters each line draws. Only a span that pi's parser makes (strongPairs) is drawn, and only
 * when the color escapes cannot change how pi reads any delimiter: both delimiters are runs of exactly two,
 * the escape on each inner side leaves the run's flanking class as it was (runKind), no delimiter or email
 * sits next to an escape, and the span holds no "](" that the escape's "[" could turn into a link. A span is
 * read over its paragraph: consecutive prose lines that all belong to a top-level paragraph. Other prose lines
 * (lists, quotes) draw a span only when the line alone and its run of prose lines read the same spans there
 * (they do when no token of the run spans a line break).
 * Every other run is left as written, so pi shows it as it would without the extension.
 */
function boldPlans(lines: string[], read: ReadLine[]): (LinePlan | undefined)[] {
	const plans: (LinePlan | undefined)[] = [];
	const plan = (i: number) => (plans[i] ??= { marks: new Map(), continued: false });
	for (let i = 0; i < lines.length; ) {
		if (read[i].kind !== "prose") {
			i++;
			continue;
		}
		let j = i;
		let marked = false;
		let paragraph = true;
		for (; j < lines.length && read[j].kind === "prose"; j++) {
			marked ||= BOLD_RUN.test(lines[j]);
			paragraph &&= read[j].plain;
		}
		if (!marked) {
			i = j;
			continue;
		}
		const starts: number[] = [];
		const literal: Range[] = [];
		let text = "";
		for (let k = i; k < j; k++) {
			starts.push(text.length);
			for (const [s, e] of read[k].literal) literal.push([text.length + s, text.length + e]);
			text += k < j - 1 ? lines[k] + "\n" : lines[k];
		}
		const lineOf = (at: number) => {
			let k = starts.length - 1;
			while (starts[k] > at) k--;
			return k;
		};
		// Tables and HTML blocks are not one inline text for pi: nothing in them is drawn.
		if ((text.includes("<") && lines.slice(i, j).some((l) => HTML_START.test(l))) || (text.includes("|") && lines.slice(i, j).some((l) => l.includes("-") && TABLE_DELIMITER.test(l)))) {
			i = j;
			continue;
		}
		// The first sign that may open pending math, outside literal ranges: spans that reach it are not drawn.
		let math = text.length;
		if (text.includes("$") || text.includes("\\")) for (const m of text.matchAll(MATH_SIGN)) {
			if (literal.some(([s, e]) => s <= m.index && m.index < e) || !UNESCAPED_AT(text, m.index)) continue;
			math = m.index;
			break;
		}
		// The marker starts the drawing visits on each line (drawProse matches INLINE in each prose part): a planned
		// delimiter inside a pill or literal range would never be drawn.
		// Read per line when a span there is about to be planned.
		const visitedSets: Set<number>[] = [];
		// The matches read here, handed to drawProse with the line's plan so it does not read them again.
		const inlineOf: (RegExpExecArray[] | undefined)[][] = [];
		const visited = (k: number) => {
			let set = visitedSets[k];
			if (set) return set;
			set = visitedSets[k] = new Set<number>();
			const inline: (RegExpExecArray[] | undefined)[] = (inlineOf[k] = []);
			let at = 0;
			for (const part of partsOf(lines[i + k], read[i + k].literal)) {
				if (!part.literal) {
					const matches: RegExpExecArray[] = [];
					INLINE.lastIndex = 0;
					for (let m: RegExpExecArray | null; (m = INLINE.exec(part.text)) !== null; ) {
						matches.push(m);
						if (m[2] !== undefined && m[1].length % 2 === 0) set.add(at + m.index + m[1].length);
					}
					inline.push(matches);
				} else inline.push(undefined);
				at += part.text.length;
			}
			return set;
		};
		// lexInline emits outer pairs before inner ones, with increasing opener offsets.
		const { pairs, crossesLine } = strongPairs(text, literal);
		// Lines whose own reading differs from their run's reading: pi may read either, so nothing is drawn there.
		const unsure = new Set<number>();
		// Without a token across a line break, each line reads alone as it reads in its run.
		if (!paragraph && j - i > 1 && crossesLine) {
			const inRun = new Map<number, string[]>();
			for (const [o, c] of pairs) {
				const lo = lineOf(o);
				const lc = lineOf(c);
				if (lo !== lc) {
					unsure.add(lo);
					unsure.add(lc);
				} else (inRun.get(lo) ?? inRun.set(lo, []).get(lo)!).push(o - starts[lo] + ":" + (c - starts[lo]));
			}
			for (let k = 0; k < j - i; k++) {
				if (!BOLD_RUN.test(lines[i + k])) continue;
				const own = strongPairs(lines[i + k], read[i + k].literal).pairs.map(([o, c]) => o + ":" + c).join(" ");
				if (own !== (inRun.get(k) ?? []).join(" ")) unsure.add(k);
			}
		}
		// Read once per group: "](" at or after o is lastLink >= o; text without LINK_TEXT holds none in any span.
		const lastLink = text.lastIndexOf("](");
		const linkText = LINK_TEXT.test(text);
		let drawnEnd = -1;
		for (const [o, c] of pairs) {
			// A span inside a drawn span is bold already; its close would end the outer color early.
			if (o < drawnEnd) continue;
			const d = text[o];
			if (text[o - 1] === d || text[o + 2] === d || text[c - 1] === d || text[c + 2] === d) continue;
			const innerFirst = charAt(text, o + 2);
			const innerLast = charBefore(text, c);
			if ("*_~".includes(innerFirst) || "*_~".includes(innerLast)) continue;
			// An escape's "[" with a later "](" makes a link; text with a URL or email may take an escape into its target.
			if (c + 2 > math || lastLink >= o || (linkText && LINK_TEXT.test(text.slice(o + 2, c)))) continue;
			// Right after a bare URL (cut by pi at CJK punctuation) the escape would join the URL's target.
			if (literal.some(([s, e]) => e === o && LINK_TEXT.test(text.slice(s, e)))) continue;
			const run = d + d;
			const before = charBefore(text, o);
			const after = charAt(text, c + 2);
			if (runKind(before, run, innerFirst) !== runKind(before, run, "\x1b") || runKind(innerLast, run, after) !== runKind("m", run, after)) continue;
			if (opensLeft(before, run, innerFirst) !== opensLeft(before, run, "\x1b")) continue;
			// The bold color is restored after each literal range inside the span: not before a character the escape
			// would change, and not after HTML or an autolink (pi drops a comment with its space).
			if (literal.some(([s, e]) => s > o && s < c && (text[s] === "<" || AFTER_LITERAL.includes(text[e] ?? "")))) continue;
			const lo = lineOf(o);
			const lc = lineOf(c);
			if (unsure.has(lo) || unsure.has(lc)) continue;
			if (!visited(lo).has(o - starts[lo]) || !visited(lc).has(c - starts[lc])) continue;
			if (lo !== lc) {
				// The color ends at each line end and starts again after the next line's indent: the characters
				// there keep their class only when they are plain.
				if (!paragraph) continue;
				let fits = true;
				for (let k = lo + 1; k <= lc && fits; k++) {
					const end = starts[k] - 1;
					const first = lines[i + k].search(/\S/);
					fits = plainChar(charBefore(text, end)) && first >= 0 && plainChar(charAt(text, starts[k] + first));
				}
				if (!fits) continue;
			}
			plan(i + lo).marks.set(o - starts[lo], "open");
			plan(i + lc).marks.set(c - starts[lc], "close");
			for (let k = lo + 1; k <= lc; k++) plan(i + k).continued = true;
			drawnEnd = c + 2;
		}
		for (let k = 0; k < j - i; k++) if (inlineOf[k] && plans[i + k]) plans[i + k]!.inline = inlineOf[k];
		i = j;
	}
	return plans;
}

/** Draws each line of a reply; every output line is the drawing of the input line with the same index. */
// definitions: as in readBlocks.
function draw(lines: string[], palette: Palette, definitions = true): Drawing {
	const { read, boundary, end } = readBlocks(lines, definitions);
	const [open, close] = boldEnds(palette);
	const plans = boldPlans(lines, read);
	const pills: string[] = [];
	let scoreboard = false;
	let pillsAtBoundary = 0;
	let scoreboardAtBoundary = false;
	const out = lines.map((line, i) => {
		if (i === boundary + 1) {
			pillsAtBoundary = pills.length;
			scoreboardAtBoundary = scoreboard;
		}
		const { kind, literal } = read[i];
		if (kind === "heading") return drawHeading(line, literal);
		if (kind !== "prose") return line;
		if (literal.length === 0 && PILLS_ONLY.test(line)) scoreboard = true;
		return drawProse(line, literal, palette, open, close, pills, plans[i], quoted(line));
	});
	return { lines: out, pills, scoreboard, read, boundary, pillsAtBoundary, scoreboardAtBoundary, end };
}

/**
 * Apply colors to assistant Markdown, leaving code, HTML comments and headings' text alone. With a cache,
 * the finished blocks of an earlier call on the same reply are reused and only the rest is drawn: by
 * readBlocks' boundary rule, drawing the head and the rest apart equals drawing the whole. A call without a
 * matching head draws the whole reply as before, so it is the reference for the reuse (test/cache.test.ts).
 */
function decorate(markdown: string, palette: Palette, streaming: boolean, cache: { head?: Head }): string {
	let head = cache.head;
	// A head that ends with a CR does not fit a reply whose next character is LF: that CRLF is one line break.
	if (head && (head.palette !== palette || markdown.length < head.length || !markdown.startsWith(head.source.slice(0, head.length)) || (markdown[head.length] === "\n" && markdown[head.length - 1] === "\r"))) head = undefined;
	let restText = head ? markdown.slice(head.length) : markdown;
	// pi's parser reads CRLF and CR as line breaks too; the drawing keeps each break as written.
	let { lines, breaks } = splitLines(restText);
	// A link definition after the head may turn reference-link text in the head into a link: read it all again.
	if (head && restText.includes("]:") && lines.some(mayDefine)) {
		head = undefined;
		restText = markdown;
		({ lines, breaks } = splitLines(restText));
	}
	if (head) head.source = markdown;
	// The text that lines split from, while they still do (joinDrawn).
	let source: string | undefined = restText;
	// Every line drawn below is a line of restText or a prefix of one: without "]:" in it, none may define a label.
	const definitions = restText.includes("]:");
	let drawing = draw(lines, palette, definitions);
	// Streaming only: an unfinished tail waits until it completes, so it never shows raw and then jumps.
	if (streaming) {
		const last = lines.length - 1;
		// pi reads the drawn text, where a "$" before a digit is escaped: such a sign opens no pending math there.
		const end = drawing.end.literal && lines.some((l) => DOLLAR_DIGIT.test(l)) ? readBlocks(lines.map(escapeCurrency)).end : drawing.end;
		const from = heldFrom(lines[last], drawing.read[last], end);
		// The text before a held tail loses its trailing spaces; a line left empty goes, with its line break.
		const kept = from >= 0 ? lines[last].slice(0, from).replace(/[ \t]+$/, "") : undefined;
		const cut = kept === "" ? HOLD_LINE : from;
		if (cut === HOLD_LINE && last === 0) {
			if (!head) return "";
			// The held line is all the text after the head: the line break that ends the head text goes too.
			const lf = markdown[head.length - 1] === "\n" && markdown[head.length - 2] === "\r" ? 2 : 1;
			return head.out.slice(0, -lf);
		}
		if (cut === HOLD_LINE && last > 0) {
			lines = lines.slice(0, last);
			source = undefined;
			breaks = breaks?.slice(0, last - 1);
			drawing = draw(lines, palette, definitions);
		} else if (kept !== undefined && cut >= 0) {
			lines = [...lines.slice(0, last), kept];
			source = undefined;
			drawing = draw(lines, palette, definitions);
		}
	}
	const scoreboard = (head?.scoreboard ?? false) || drawing.scoreboard;
	// The count line waits for the whole reply: drawn while streaming, it would move the text below it.
	const line = streaming || scoreboard ? undefined : tally(head ? [...head.pills, ...drawing.pills] : drawing.pills);
	let out: string;
	// Joined only when needed: a reply with a count line is joined once, below.
	let drawn = "";
	if (line) {
		const [open, close] = boldEnds(palette);
		const read = head ? [...head.read, ...drawing.read] : drawing.read;
		// After the last block, so nothing above it moves; a reply that ends inside a block a blank line does
		// not close keeps the count line at its place near the top: an open HTML block of types 1, 3-5 or display
		// math (the reader's end state), or an open fence or comment (whose last text is code; the sentinel read).
		// By readBlocks' boundary rule the lines after the boundary end in the state the whole reply ends in.
		let lastText = read.length - 1;
		while (lastText >= 0 && read[lastText].kind === "blank") lastText--;
		const atEnd = drawing.end.open || (read[lastText]?.kind === "code" && endsOpen(lines.slice(drawing.boundary + 1))) ? countPlace(read) : read.length;
		// A count line after the whole reply: a cached head's drawing already ends with its line break.
		if (atEnd === read.length) out = (head?.out ?? "") + joinDrawn(drawing.lines, lines, breaks, source) + "\n\n" + drawProse(line, [], palette, open, close);
		else {
			// A drawn line holds no line break, so the head's drawing splits back into its lines.
			const headLines: { lines: string[]; breaks?: string[] } = head ? splitLines(head.out) : { lines: [""] };
			const all = [...headLines.lines.slice(0, -1), ...drawing.lines];
			const lf = (n: number) => Array<string>(n).fill("\n");
			const allBreaks = breaks || headLines.breaks ? [...(headLines.breaks ?? lf(headLines.lines.length - 1)), ...(breaks ?? lf(lines.length - 1))] : undefined;
			// read has one entry per line of all.
			all.splice(atEnd, 0, drawProse(line, [], palette, open, close), "");
			allBreaks?.splice(atEnd, 0, "\n", "\n");
			out = joinLines(all, allBreaks);
		}
	} else out = (head?.out ?? "") + (drawn = joinDrawn(drawing.lines, lines, breaks, source));
	// Streaming only: move the newly finished blocks into the head. A finished reply (the last call, a history
	// load, a width change) is drawn once per change and builds none. The boundary line must end with a line
	// break here, so that the head text is a prefix of this reply.
	// A CR that ends the text may be the first half of a CRLF, but the head never ends with it: after it comes
	// an empty last line, a blank line that is itself the boundary, so drawing.boundary is never the line before.
	if (streaming && drawing.boundary >= 0 && drawing.boundary < lines.length - 1) {
		const n = drawing.boundary + 1;
		const next: Head = head ?? { palette, source: markdown, length: 0, out: "", read: [], pills: [], scoreboard: false };
		// Lines 0..n-1 with their line breaks, cut from the joined text and drawing instead of joined again.
		let textLength = 0;
		let outLength = 0;
		for (let i = 0; i < n; i++) {
			const breakLength = breaks ? breaks[i].length : 1;
			textLength += lines[i].length + breakLength;
			outLength += drawing.lines[i].length + breakLength;
		}
		next.length += textLength;
		// Each character is detached once per reply: when its block finishes.
		next.out += detach(drawn.slice(0, outLength));
		for (let i = 0; i < n; i++) next.read.push(drawing.read[i]);
		for (let i = 0; i < drawing.pillsAtBoundary; i++) next.pills.push(detach(drawing.pills[i]));
		next.scoreboard ||= drawing.scoreboardAtBoundary;
		head = next;
	}
	cache.head = head;
	return out;
}

/** heldFrom: the whole last line waits, with the line break before it. */
const HOLD_LINE = -2;
/** The most label characters an unfinished pill or bold may hold and still wait: a pill label has 1 to 32 (PILL). */
const HOLD_LABEL = 32;
/** Signs that may open code, math, HTML or an escape: a held tail never holds one. */
const LITERAL_SIGN = /[`$<\\]/;
const UNFINISHED_PILL = new RegExp(String.raw`^\[\[[^\[\]\n]{0,${HOLD_LABEL}}\]?$`);
const COMPLETE_PILL = new RegExp(PILL_SKIP, "g");
const WHITESPACE = /\s/;
const PUNCTUATION = /[\p{P}\p{S}]/u;
const escapeCurrency = (line: string) => line.replace(CURRENCY, (_, before: string) => before + "\\$");
const UNESCAPED_AT = (line: string, at: number) => (line.slice(0, at).match(/\\*$/)![0].length % 2 === 0);

/**
 * Where the last line of a streaming reply is cut so that its unfinished tail waits: -1 to keep it all,
 * HOLD_LINE for an unfinished heading (pi trims the text, so a heading is finished only when a line follows),
 * otherwise the index of an unfinished trailing pill ("[[Wor", "["), or of an opening bold marker that nothing
 * closes yet ("**Resu", "__Resu", a lone "*" or "_" after a space).
 * Nothing waits when the reply may end in literal text (an HTML block or paragraph, pending math), when the
 * tail is in a literal range or holds a sign that may open one, or when something before the tail on its line
 * may open literal text that reaches into it (an unclosed backtick, "<", math "$", "\\(" or "\\[").
 */
function heldFrom(line: string, read: ReadLine, end: EndState): number {
	if (end.literal) return -1;
	if (read.kind === "heading") return read.literal.length === 0 && !mayOpenLiteral(line, [], line.length) ? HOLD_LINE : -1;
	if (read.kind !== "prose" || line === "") return -1;
	const candidates: number[] = [];
	const open = line.lastIndexOf("[[");
	if (open >= 0 && UNFINISHED_PILL.test(line.slice(open)) && UNESCAPED_AT(line, open)) candidates.push(open);
	else if (line.endsWith("[") && !line.endsWith("[[") && UNESCAPED_AT(line, line.length - 1)) candidates.push(line.length - 1);
	const bold = openBold(line, read.literal);
	if (bold >= 0) candidates.push(bold);
	let cut = -1;
	for (const at of candidates) {
		if (read.literal.some(([, e]) => e > at) || LITERAL_SIGN.test(line.slice(at)) || mayOpenLiteral(line, read.literal, at)) continue;
		if (cut < 0 || at < cut) cut = at;
	}
	return cut;
}

/**
 * Whether text of line before index `until`, outside the literal ranges, may open literal text that reaches
 * past it: an unclosed backtick, a "<" with no ">" after it, a "$" before a character other than a digit
 * (the drawing escapes those), or "\\(" and "\\[" (pi's inline math). An escaped character opens nothing.
 */
function mayOpenLiteral(line: string, literal: Range[], until: number): boolean {
	let r = 0;
	for (let i = 0; i < until; i++) {
		while (r < literal.length && literal[r][1] <= i) r++;
		if (r < literal.length && literal[r][0] <= i) {
			i = literal[r][1] - 1;
			continue;
		}
		const c = line[i];
		if (c === "\\") {
			if (line[i + 1] === "(" || line[i + 1] === "[") return true;
			i++;
		} else if (c === "\x60") return true;
		// A "$" at the line end is undecided: what follows decides.
		else if (c === "$" && i + 1 < line.length && !/\d/.test(line[i + 1])) return true;
		else if (c === "<" && !line.slice(i + 1, until).includes(">")) return true;
	}
	return false;
}

/**
 * The index of the last opening bold marker of line that nothing on the line closes, -1 for none: a run of
 * two "*" or "_" that is left-flanking and not right-flanking (CommonMark), outside literal ranges and complete
 * pills; or a run of one or two at the line end after a space or at the line start, which may still open bold.
 * A closing run never waits (it may close bold an earlier line opened), and neither does a run between spaces.
 * The bold may hold at most HOLD_LABEL characters, a first closing star or underscore not counted.
 */
function openBold(line: string, literal: Range[]): number {
	const pills: Range[] = [];
	if (line.includes("[[")) for (const m of line.matchAll(COMPLETE_PILL)) pills.push([m.index, m.index + m[0].length]);
	let open = -1;
	let r = 0;
	let k = 0;
	for (let i = 0; i < line.length; ) {
		const c = line[i];
		if (c !== "*" && c !== "_") {
			i++;
			continue;
		}
		let j = i;
		while (line[j] === c) j++;
		while (r < literal.length && literal[r][1] <= i) r++;
		while (k < pills.length && pills[k][1] <= i) k++;
		const inside = (r < literal.length && literal[r][0] <= i) || (k < pills.length && pills[k][0] <= i);
		if (!inside && j - i <= 2 && UNESCAPED_AT(line, i)) {
			const prev = line[i - 1];
			const next = line[j];
			const spaceBefore = prev === undefined || WHITESPACE.test(prev);
			const left = next !== undefined && !WHITESPACE.test(next) && (!PUNCTUATION.test(next) || spaceBefore || PUNCTUATION.test(prev));
			const right = !spaceBefore && (!PUNCTUATION.test(prev) || next === undefined || WHITESPACE.test(next) || PUNCTUATION.test(next));
			if (j - i === 2 && open >= 0 && right && line[open] === c) open = -1;
			else if (j - i === 2 && left && !right) open = i;
			else if (next === undefined && spaceBefore && open < 0) open = i;
		}
		i = j;
	}
	if (open < 0) return -1;
	const partialClose = line.length - open > 3 && line.endsWith(line[open]) ? 1 : 0;
	return line.length - open - 2 - partialClose <= HOLD_LABEL ? open : -1;
}

/** A sentinel after the written lines that is not a top-level paragraph: they end inside a block a blank line does not close. */
function endsOpen(lines: string[]): boolean {
	const read = readMarkdown([...lines, "", "x"]);
	const sentinel = read[read.length - 1];
	return sentinel.kind !== "prose" || !sentinel.plain;
}

const LINE_BREAK = /\r\n|\r|\n/g;
/** Lines split at LF, CRLF and CR; breaks is undefined when every break is LF. */
function splitLines(text: string): { lines: string[]; breaks?: string[] } {
	if (!text.includes("\r")) return { lines: text.split("\n") };
	return { lines: text.split(LINE_BREAK), breaks: text.match(LINE_BREAK)! };
}
/**
 * joinLines(drawn, breaks), where drawn is the drawing of lines and lines split from source (when given): a run
 * of lines drawn unchanged (code, blank) is cut from source as one piece instead of joined line by line.
 */
function joinDrawn(drawn: string[], lines: string[], breaks?: string[], source?: string): string {
	if (source === undefined) return joinLines(drawn, breaks);
	const pieces: string[] = [];
	// The start in source of the current run of unchanged lines, -1 for none; at, the start of line i.
	let run = -1;
	let at = 0;
	for (let i = 0; i < lines.length; i++) {
		const breakLength = i === lines.length - 1 ? 0 : breaks ? breaks[i].length : 1;
		if (drawn[i] === lines[i]) {
			if (run < 0) run = at;
		} else {
			if (run >= 0) pieces.push(source.slice(run, at));
			run = -1;
			pieces.push(drawn[i]);
			if (breakLength) pieces.push(breaks ? breaks[i] : "\n");
		}
		at += lines[i].length + breakLength;
	}
	if (run >= 0) pieces.push(source.slice(run, at));
	return pieces.join("");
}
/** The inverse of splitLines. */
function joinLines(lines: string[], breaks?: string[]): string {
	if (!breaks) return lines.join("\n");
	let out = lines[0];
	for (let i = 1; i < lines.length; i++) out += breaks[i - 1] + lines[i];
	return out;
}

const SPACE_CHAR = /\s/;
const HEADING_LINE = /^([ \t>]*#{1,6}[ \t]+)(.+)$/;
/** Pi already colors headings: a heading only takes its label icon and the currency escape. */
function drawHeading(line: string, literal: Range[]): string {
	const text = partsOf(line, literal)
		.map((p) => (p.literal ? p.text : escapeProse(p.text)))
		.join("");
	return text.replace(HEADING_LINE, (_, hashes: string, title: string) => hashes + withLabelIcon(title));
}

/** A line cut into its literal ranges and the prose between them. */
function partsOf(line: string, literal: Range[]): { text: string; literal: boolean }[] {
	const parts: { text: string; literal: boolean }[] = [];
	let at = 0;
	for (const [start, end] of literal) {
		if (start > at) parts.push({ text: line.slice(at, start), literal: false });
		parts.push({ text: line.slice(start, end), literal: true });
		at = end;
	}
	if (at < line.length || parts.length === 0) parts.push({ text: line.slice(at), literal: false });
	return parts;
}
/** Lead-in words that name the action a pill calls for. With a colon they take an icon anywhere in a line. */
const ACTION_ICONS: Record<string, string> = {
	check: "\uf046", do: "\uf0a4", next: "\uf061", unblock: "\uf09c", left: "\uf141", run: "\uf04b", guard: "\uf132", undo: "\uf0e2", see: "\uf08e",
};

/** Prefix a known label with its icon, unless it already opens with a glyph. */
function withLabelIcon(label: string): string {
	if (OWN_ICON.test(label)) return label;
	// label.replace(/[:\s]+$/, "").trim(), without a regex search over a long title: the trailing colons and
	// white space go first, then the leading white space (\s and trim() take the same characters).
	let end = label.length;
	while (end > 0 && (label[end - 1] === ":" || SPACE_CHAR.test(label[end - 1]))) end--;
	const word = label.slice(0, end).trimStart().toLowerCase();
	const icon = own(LABEL_ICONS, word) ?? (label.trimEnd().endsWith(":") ? own(ACTION_ICONS, word) : undefined);
	return icon ? icon + ICON_SPACE + label : label;
}

// A line's leading bold label, after an optional list marker, tree connector, or kind-of-work pill.
// Each whitespace run is followed by a non-space token, so a failed match costs time linear in the line.
const LEAD_LABEL = /^(\s*(?:(?:[-*+]|\d+\.)\s*)?(?:[├└]──\s*)?(?:\[\[[^\[\]\n]{1,32}\]\]\s*)?\*\*)([^*`\n]{1,32})(\*\*)/;

const NBSP = "\u00a0";
/**
 * The space between a pill's icon and its word: an en space. Ghostty (1.4.0, src/font) lets a Nerd Font
 * icon draw over two cells only when a space, an en space or an empty cell follows it, so the icon grows
 * to about the height of the letters in the same pill width. pi wraps lines only at U+0020, so the icon
 * and its word stay on one line. Other terminals draw it as a one-cell space.
 */
const ICON_SPACE = "\u2002";
/** Edge glyphs: rounded Powerline caps (one cell), half blocks (half a cell), or none (sharp pads with a filled space). */
const EDGE_GLYPHS: Record<Edges, [string, string]> = { round: ["\ue0b6", "\ue0b4"], half: ["\u2590", "\u258c"], sharp: ["", ""] };

/** Memo of pill() per palette, with detached keys and cleared at LABEL_MEMO_MAX like the label memo. */
const pillMemo = new WeakMap<Palette, Map<string, string>>();
function pill(label: string, palette: Palette): string {
	let memo = pillMemo.get(palette);
	if (!memo) pillMemo.set(palette, (memo = new Map()));
	let drawn = memo.get(label);
	if (drawn === undefined) {
		if (memo.size >= LABEL_MEMO_MAX) memo.clear();
		const key = detach(label);
		memo.set(key, (drawn = drawPill(key, palette)));
	}
	return drawn;
}

function drawPill(label: string, palette: Palette): string {
	const style = palette.pills[toneOf(label)];
	// No-break spaces keep a two-word pill on one line when Pi wraps the paragraph.
	const { icon, word } = splitLabel(label, palette.icons);
	const shown = (icon && word ? word : word || label.trim()).replace(CURRENCY, (_, before: string) => before + "\\$").replace(/ /g, NBSP);
	const text = icon && word ? icon + ICON_SPACE + shown : shown;
	const [left, right] = style.cap ? EDGE_GLYPHS[palette.edges] : ["", ""];
	const pad = style.cap && palette.edges === "sharp" ? NBSP : "";
	// A cap's escape may open faint text (a faint theme color): the cap closes it with the foreground.
	const capEnd = resetsWeight(style.cap) === false ? "\x1b[22;39m" : "\x1b[39m";
	const capL = left ? `${style.cap}${left}${capEnd}` : "";
	const capR = right ? `${style.cap}${right}${capEnd}` : "";
	return `${capL}${style.label}\x1b[1m${pad}${text}${pad}\x1b[22;27m\x1b[39m\x1b[49m${capR}`;
}

/** Pills next to each other are separated by two spaces. */
const PILL_GAP = /\]\] \[\[/g;

// pi's Markdown reads "$" as the start of LaTeX math, and a later "*" makes it print the rest of the
// line raw. Before a digit, "$" is a currency sign: escape it, unless it opens math that pi draws.
const CURRENCY = /(^|[^\\$])\$(?=\d)/g;
const DOLLAR_OR_PILL = new RegExp(PILL_SKIP + String.raw`|(?<![\\$])\$(?=\d)`, "g");

/** Whether the "$" at index "at" opens inline math for pi (tokenizeInlineLatex in pi-tui's markdown.js). */
function opensMath(text: string, at: number): boolean {
	const escaped = (i: number) => (text.slice(0, i).match(/\\*$/)![0].length % 2 === 1);
	let close = text.indexOf("$", at + 1);
	while (close >= 0 && escaped(close)) close = text.indexOf("$", close + 1);
	if (close < 0) return false;
	const body = text.slice(at + 1, close);
	return body !== "" && !/\s$/.test(body) && !/^\d/.test(text.slice(close + 1)) && !body.includes("\x60");
}

/** Escapes currency signs in prose, outside pills and math. */
// Only a "$" before a digit is escaped; a pill match is kept as written.
const DOLLAR_DIGIT = /\$\d/;
const escapeProse = (text: string) =>
	!DOLLAR_DIGIT.test(text) ? text : text.replace(DOLLAR_OR_PILL, (m: string, at: number) => (m !== "$" || opensMath(text, at) ? m : "\\$"));

// An action lead-in after a drawn opening "**": the word, then ":**".
const ACTION_AFTER = new RegExp(String.raw`^(${Object.keys(ACTION_ICONS).join("|")})(?=:\*\*)`, "i");
/** The icon of an action lead-in in rest, the text after a drawn opener at start, when its ":**" is the drawn closer. */
const actionIcon = (rest: string, start: number | undefined, marks: Map<number, "open" | "close"> | undefined) => {
	const word = ACTION_AFTER.exec(rest)?.[1];
	if (word === undefined || start === undefined || marks?.get(start + 2 + word.length + 1) !== "close") return "";
	return ACTION_ICONS[word.toLowerCase()] + ICON_SPACE;
};

// A prose line without any of these marks draws as written: every step below leaves it unchanged.
const PROSE_MARKS = /\[\[|\*\*|__|\$|[✓✔✗✘→├└]/;
const GLYPHS = /[✓✔✗✘→├└]/;
/** GLYPHS, a pill gap (PILL_GAP) or DOLLAR_DIGIT. */
const PART_SIGNS = /[✓✔✗✘→├└]|\]\] \[\[|\$\d/;
/** Characters that may be part of an emphasis or strikethrough delimiter. */
const DELIMITER_CHARS = "*_~";
const DELIMITER_IN = /[*_~]/;
/** A character that may be part of an email address's local part (marked's GFM email rule). */
const EMAIL_CHAR = /[A-Za-z0-9._+-]/;

const LIST_PREFIX = / {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+/y;
const QUOTE_PREFIX = / {0,3}>[ \t]?/y;
const LIST_START = /^[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
/** The end of a prefix that re (sticky) matches at index at of line, -1 for none. */
const prefixEnd = (re: RegExp, line: string, at: number) => {
	re.lastIndex = at;
	return re.test(line) ? re.lastIndex : -1;
};
/**
 * Whether pi draws a prose line in a block quote's color, which a pill or glyph's closing escapes end: the line
 * opens with ">" after list markers and no list marker follows (pi's list bullet ends the quote color on its line).
 * Each prefix is consumed once, so the cost is linear in the line. A quote's lazy continuation line (no ">") is
 * not recognized and keeps the reset.
 */
function quoted(line: string): boolean {
	let at = 0;
	let next: number;
	while ((next = prefixEnd(LIST_PREFIX, line, at)) >= 0) at = next;
	let quote = false;
	while ((next = prefixEnd(QUOTE_PREFIX, line, at)) >= 0) {
		at = next;
		quote = true;
	}
	return quote && !LIST_START.test(line.slice(at));
}
/**
 * Whether escapes end with intensity reset (SGR 22 or 0: true), set (SGR 1 or 2: false) or untouched (undefined).
 * The color parameters of SGR 38, 48 and 58 are skipped.
 */
function resetsWeight(escapes: string): boolean | undefined {
	let reset: boolean | undefined;
	for (const m of escapes.matchAll(/\x1b\[([0-9;]*)m/g)) {
		const ps = m[1].split(";");
		for (let k = 0; k < ps.length; k++) {
			const p = ps[k];
			if (p === "38" || p === "48" || p === "58") k += ps[k + 1] === "2" ? 4 : 2;
			else if (p === "22" || p === "0" || p === "") reset = true;
			else if (p === "1" || p === "2") reset = false;
		}
	}
	return reset;
}
/** Memo of whether a glyph color's escapes end with an intensity reset (a faint theme color closes with SGR 22). */
const glyphResetMemo = new WeakMap<Colorize, boolean>();
const glyphResets = (color: Colorize) => {
	let reset = glyphResetMemo.get(color);
	if (reset === undefined) glyphResetMemo.set(color, (reset = resetsWeight(color("")) === true));
	return reset;
};

function drawProse(line: string, literal: Range[], palette: Palette, open: string, close: string, drawn?: string[], plan?: LinePlan, inQuote = false): string {
	if (!plan?.continued && !PROSE_MARKS.test(line)) return line;
	const marks = plan?.marks;
	const parts = partsOf(line, literal);
	const written = parts.map((part) => part.text);
	// The lead label's icon: where it goes in part 0 and its length.
	let iconAt = 0;
	let iconLength = 0;
	if (marks?.size && !parts[0].literal && parts[0].text.includes("**")) {
		// Only a lead label pi draws bold takes its icon.
		const lead = LEAD_LABEL.exec(parts[0].text);
		if (lead && marks.get(lead[1].length - 2) === "open" && marks.get(lead[1].length + lead[2].length) === "close") {
			const label = withLabelIcon(lead[2]);
			iconAt = lead[1].length;
			iconLength = label.length - lead[2].length;
			parts[0].text = lead[1] + label + lead[3] + parts[0].text.slice(lead[0].length);
		}
	}
	let result = "";
	let inBold = plan?.continued === true;
	// After a pill or glyph, the styles its closing escapes ended: the quote color, the bold weight of a bold span
	// (after an intensity reset), and the bold color. A table header's bold is not restored: pi prints a table raw
	// when the pane is narrow, and the drawing cannot know the width.
	const restore = (weightReset: boolean) => (inQuote ? palette.quote : "") + (weightReset && inBold ? "\x1b[1m" : "") + (inBold ? open : "");
	const glyph = (m: string, color: Colorize) => color(m) + restore(glyphResets(color));
	// The start in the line of each part.
	let at = 0;
	for (let p = 0; p < parts.length; p++) {
		const part = parts[p];
		const partAt = at;
		at += written[p].length;
		if (part.literal) {
			// Pi's code color ends with a foreground reset; restore the bold color after it.
			result += inBold ? part.text + open : part.text;
			continue;
		}
		// One search first: a part without a glyph, a pill gap or a "$" before a digit is its own prose.
		const plain = !PART_SIGNS.test(part.text);
		const glyphs = !plain && GLYPHS.test(part.text);
		const pattern = glyphs ? INLINE_OR_GLYPH : INLINE;
		// Pills are read from the written text, before any escape or color is added around them.
		const prose = plain ? part.text : escapeProse(part.text.includes("]] [[") ? part.text.replace(PILL_GAP, "]]  [[") : part.text);
		// The start in the line of each match, when the line draws bold. Without escapes or gaps added, a match's
		// index in prose is its index in the line, past the lead label's icon; otherwise the matches of the
		// written part give them in order (the steps before the drawing add no marker, pill or glyph).
		let starts: number[] | undefined;
		if (marks?.size && prose !== part.text) {
			starts = [];
			pattern.lastIndex = 0;
			for (let m: RegExpExecArray | null; (m = pattern.exec(written[p])) !== null; ) starts.push(partAt + m.index + (m[1] ?? "").length);
		}
		const startOf = (index: number, slashes: string | undefined) =>
			!marks?.size ? undefined : starts ? starts[n] : partAt + index + (slashes ?? "").length - (p === 0 && index >= iconAt + iconLength && iconLength > 0 ? iconLength : 0);
		let n = 0;
		// A pill or glyph next to a delimiter is drawn as written: its color escapes would change how pi reads the
		// delimiter. Next to a drawn delimiter, on the side inside the bold, it is drawn.
		// At the part's end, the next character is the first of a literal range: an email address there would take
		// the escape's "49m" or "39m" into its link target.
		const next = line[partAt + written[p].length];
		const kept = (m: string, index: number, start: number | undefined) => {
			const before = prose[index - 1];
			const after = prose[index + m.length];
			if (after === undefined && next !== undefined && EMAIL_CHAR.test(next)) return true;
			return (
				(before !== undefined && DELIMITER_CHARS.includes(before) && (start === undefined || marks!.get(start - 2) !== "open")) ||
				(after !== undefined && DELIMITER_CHARS.includes(after) && (start === undefined || marks!.get(start + m.length) !== "close"))
			);
		};
		// One pass over markers, pills and glyphs. A glyph never holds a character a marker or a pill starts
		// with, so the matches are those of INLINE with the glyphs of the text between them.
		const each = (index: number, match: string, slashes?: string, marker?: string, label?: string, passed?: string, failed?: string, arrow?: string, tree?: string) => {
			const start = startOf(index, slashes);
			n++;
			if (label === undefined && marker === undefined) {
				if (kept(match, index, start)) return match;
				if (passed !== undefined) return glyph(match, palette.passed);
				if (failed !== undefined) return glyph(match, palette.failed);
				if (arrow !== undefined) return glyph(match, palette.arrow);
				if (tree !== undefined) return glyph(match, palette.tree);
				return match;
			}
			if (label !== undefined) {
				// A label with a delimiter character stays as written: pi may pair it with a delimiter outside the pill.
				if (!label.trim() || DELIMITER_IN.test(label) || kept(match, index, start)) return match;
				drawn?.push(label);
				// A pill ends with an intensity reset (SGR 22).
				return pill(label, palette) + restore(true);
			}
			const mark = start === undefined || slashes!.length % 2 === 1 ? undefined : marks!.get(start);
			if (mark === "open") {
				inBold = true;
				return slashes! + marker + open + actionIcon(prose.slice(index + match.length, index + match.length + 12), start, marks);
			}
			if (mark === "close") {
				inBold = false;
				return slashes! + close + marker;
			}
			return match;
		};
		// The shorter INLINE is faster where the text holds no glyph; its callback gets only its own groups.
		// (An exec loop: the same pieces as prose.replace(pattern, each), with no call from the replace builtin per match.)
		let text = "";
		let done = 0;
		// A plain part is its own prose, so boldPlans' matches of the written part are the matches of prose, past the
		// lead label's icon: the icon (a private-use glyph and an en space) starts no match and is no backslash.
		const known = plain ? plan?.inline?.[p] : undefined;
		if (known) {
			const shift = p === 0 ? iconLength : 0;
			for (const m of known) {
				const index = shift > 0 && m.index >= iconAt ? m.index + shift : m.index;
				text += prose.slice(done, index) + each(index, m[0], m[1], m[2], m[3]);
				done = index + m[0].length;
			}
		} else {
			pattern.lastIndex = 0;
			for (let m: RegExpExecArray | null; (m = pattern.exec(prose)) !== null; ) {
				text += prose.slice(done, m.index) + (glyphs ? each(m.index, m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7]) : each(m.index, m[0], m[1], m[2], m[3]));
				done = m.index + m[0].length;
			}
		}
		text += prose.slice(done);
		// A line inside a span an earlier line opened takes the bold color after its indent.
		if (p === 0 && plan?.continued) {
			const indent = text.length - text.trimStart().length;
			text = text.slice(0, indent) + open + text.slice(indent);
		}
		result += text;
	}
	// A span that a later line closes ends its color at the line end.
	if (inBold) result += close;
	return result;
}

/**
 * The reply_style section content. Pi wraps a section as <reply_style>\n…\n</reply_style>.
 * Every kind, pill, lead-in and consequence word here must stay a known word of the tables above
 * (test/reply-style.test.ts checks this).
 */
const REPLY_STYLE = `The terminal draws [[Word]] as a colored pill and gives a bold lead label an icon.
- Open with **Result:**.
- Long reply: open with [[Kind]] **Result:**, Kind one of Brainstorm, Investigate, Preview, Implement, Qualify; a ## heading per group; each bullet **Subject** [[Pill]] text.
- Pills: Done, Passed, Fixed, Observed, Recommended, Failed, Blocked, Partial, In progress, Unverified, At risk, Needs you, Decision, Destructive, Costs money, Shared.
- After a pill, the step that resolves it, led by a bold Do:, Check:, Next:, Unblock:, Left:, Guard:, Undo: or See:.
- Costs money and Destructive: once, before an action that waits for approval. Mention a cost only there, or when it passes the approved amount.`;

export default function emphasis(pi: ExtensionAPI) {
	let currentTheme: (() => Theme) | undefined;
	let settings = DEFAULT_SETTINGS;
	/** The palette with the colors object of the theme it was built from. */
	let built: { colors: Theme["colors"]; palette: Palette } | undefined;
	/** The finished-block cache of the reply drawn last (decorate). */
	const cache: { head?: Head } = {};
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		currentTheme = () => ctx.ui.theme;
		// Read once per session start; /reload picks up a change.
		settings = readSettings((pi.getSettings() as { emphasis?: unknown }).emphasis);
		built = undefined;
		cache.head = undefined;
	});
	// The rules travel with the renderer: only a session that draws pills is told to write them.
	// Outside the terminal interface the sections stay as earlier handlers left them.
	pi.on("before_agent_start", (event) => {
		if (!currentTheme) return;
		(event.systemPromptOptions.sections ??= {}).reply_style = REPLY_STYLE;
	});
	pi.registerMarkdownTransformer(
		(markdown, context) => {
			if (!currentTheme) return markdown;
			// Rebuild when the theme's colors change. ctx.ui.theme is one object (a proxy) whose target pi
			// swaps when the Theme selector of /settings switches themes. Each pi Theme hands out one frozen
			// colors object until the terminal's colors change, and its escapes and color mode are fixed at
			// construction, so a new colors object is the cheap sign of new colors (a new theme has its own).
			const theme = currentTheme();
			const colors = theme.colors;
			if (built?.colors !== colors) built = { colors, palette: createPalette(theme, settings) };
			return decorate(markdown, built.palette, context.isStreaming === true, cache);
		},
		// Assistant replies only: pi (1.5.1 and later) skips user, thinking and other Markdown.
		{ messageTypes: ["assistant"] },
	);
}
