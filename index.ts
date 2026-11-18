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
//     same-size Material Design circles; a count line of the reply's pills is drawn under the
//     first paragraph.
//   - The PI_EMPHASIS_* environment switches are gone. An optional "emphasis" block in pi's
//     settings.json sets edges, icons, label color, tone colors and fill (readSettings()).
import type { ExtensionAPI, Theme, ThemeBg, ThemeColor, ThemeToken } from "@earendil-works/pi-coding-agent";
import { backgroundAnsi, type Color, colorToRgb, foregroundAnsi, mixColors, parseColor, type RgbColorValue, rgbColor } from "@earendil-works/pi-tui";
import { countPlace, type Range, type ReadLine, readBlocks } from "./reader.ts";

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
	passed?: Colorize;
	failed?: Colorize;
	pills?: Record<PillTone, PillStyle>;
	/** Colors for arrows and tree connectors. */
	arrow?: Colorize;
	tree?: Colorize;
	edges?: Edges;
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
 * Memo of splitLabel per icon table (undefined: no icons), since a reply draws, tones and counts the same few
 * labels many times. Labels come from reply text, so each memo is cleared when it reaches LABEL_MEMO_MAX.
 */
const LABEL_MEMO_MAX = 512;
const labelMemo = new Map<Record<string, string> | undefined, Map<string, SplitLabel>>();
function splitLabel(label: string, icons?: Record<string, string>): SplitLabel {
	let memo = labelMemo.get(icons);
	if (!memo) labelMemo.set(icons, (memo = new Map()));
	let split = memo.get(label);
	if (!split) {
		if (memo.size >= LABEL_MEMO_MAX) memo.clear();
		memo.set(label, (split = readLabel(label, icons)));
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

function toneOf(label: string): PillTone {
	const { key } = splitLabel(label);
	for (const tone of ["danger", "error", "ask", "warning", "success", "mode", "owner"] as const) {
		if (TONE_WORDS[tone].includes(key)) return tone;
	}
	return "neutral";
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

function createPalette(theme: Theme, settings: EmphasisSettings = DEFAULT_SETTINGS): Palette {
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
		icons: settings.icons === "none" ? undefined : ICON_SETS[settings.icons],
	};
}

// Escaped bold markers, bold markers, or a [[pill]] of 1-32 characters. A backslash run is read from
// its start only, so a long run without a marker costs time linear in its length.
const INLINE = /(?<!\\)(\\*)(\*\*|__)|\[\[([^\[\]\n]{1,32})\]\]/g;
// A written scoreboard: a line of two or more pills and nothing else.
const PILLS_ONLY = /^\s*\[\[[^\[\]\n]{1,32}\]\](?:\s*\[\[[^\[\]\n]{1,32}\]\])+\s*$/;
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
}

/**
 * The drawn finished blocks of the reply streaming now: text is the reply up to and including the line
 * break after a finished-block boundary, the rest is its drawing, reading and pills. One per extension
 * instance; reused only while the palette is the same and the reply starts with text.
 */
interface Head {
	palette: Palette;
	text: string;
	/** The drawn lines of text, joined, plus the line break after them. */
	out: string;
	lines: string[];
	read: ReadLine[];
	pills: string[];
	scoreboard: boolean;
}

const boldEnds = (palette: Palette) => palette.bold("\u0000").split("\u0000") as [string, string];

/** Draws each line of a reply; every output line is the drawing of the input line with the same index. */
function draw(lines: string[], palette: Palette): Drawing {
	const { read, boundary } = readBlocks(lines);
	const [open, close] = boldEnds(palette);
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
		return drawProse(line, literal, palette, open, close, pills);
	});
	return { lines: out, pills, scoreboard, read, boundary, pillsAtBoundary, scoreboardAtBoundary };
}

/**
 * Apply colors to assistant Markdown, leaving code, HTML comments and headings' text alone. With a cache,
 * the finished blocks of an earlier call on the same reply are reused and only the rest is drawn: by
 * readBlocks' boundary rule, drawing the head and the rest apart equals drawing the whole. A call without a
 * matching head draws the whole reply as before, so it is the reference for the reuse (test/cache.test.ts).
 */
function decorate(markdown: string, palette: Palette, streaming = false, cache?: { head?: Head }): string {
	let head = cache?.head;
	if (head && (head.palette !== palette || !markdown.startsWith(head.text))) head = undefined;
	const lines = (head ? markdown.slice(head.text.length) : markdown).split("\n");
	const drawing = draw(lines, palette);
	const scoreboard = (head?.scoreboard ?? false) || drawing.scoreboard;
	const pills = head ? [...head.pills, ...drawing.pills] : drawing.pills;
	// The count line waits for the whole reply: drawn while streaming, it would move the text below it.
	const line = streaming || scoreboard ? undefined : tally(pills);
	let out: string;
	if (line) {
		const all = head ? [...head.lines, ...drawing.lines] : [...drawing.lines];
		const [open, close] = boldEnds(palette);
		all.splice(countPlace(head ? [...head.read, ...drawing.read] : drawing.read), 0, drawProse(line, [], palette, open, close), "");
		out = all.join("\n");
	} else out = (head?.out ?? "") + drawing.lines.join("\n");
	// Move the newly finished blocks into the head. The boundary line must end with a line break here, so
	// that the head's text is a prefix of this reply.
	if (cache && drawing.boundary >= 0 && drawing.boundary < lines.length - 1) {
		const n = drawing.boundary + 1;
		const next: Head = head ?? { palette, text: "", out: "", lines: [], read: [], pills: [], scoreboard: false };
		next.text += lines.slice(0, n).join("\n") + "\n";
		next.out += drawing.lines.slice(0, n).join("\n") + "\n";
		for (let i = 0; i < n; i++) {
			next.lines.push(drawing.lines[i]);
			next.read.push(drawing.read[i]);
		}
		for (let i = 0; i < drawing.pillsAtBoundary; i++) next.pills.push(drawing.pills[i]);
		next.scoreboard ||= drawing.scoreboardAtBoundary;
		head = next;
	}
	if (cache) cache.head = head;
	return out;
}

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
	const word = label.replace(/[:\s]+$/, "").trim().toLowerCase();
	const icon = own(LABEL_ICONS, word) ?? (label.trimEnd().endsWith(":") ? own(ACTION_ICONS, word) : undefined);
	return icon ? `${icon} ${label}` : label;
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

/** Memo of pill() per palette; cleared at LABEL_MEMO_MAX like the label memo. */
const pillMemo = new WeakMap<Palette, Map<string, string>>();
function pill(label: string, palette: Palette): string {
	let memo = pillMemo.get(palette);
	if (!memo) pillMemo.set(palette, (memo = new Map()));
	let drawn = memo.get(label);
	if (drawn === undefined) {
		if (memo.size >= LABEL_MEMO_MAX) memo.clear();
		memo.set(label, (drawn = drawPill(label, palette)));
	}
	return drawn;
}

function drawPill(label: string, palette: Palette): string {
	const style = palette.pills![toneOf(label)];
	// No-break spaces keep a two-word pill on one line when Pi wraps the paragraph.
	const { icon, word } = splitLabel(label, palette.icons);
	const shown = (icon && word ? word : word || label.trim()).replace(CURRENCY, (_, before: string) => before + "\\$").replace(/ /g, NBSP);
	const text = icon && word ? icon + ICON_SPACE + shown : shown;
	const edges = palette.edges ?? "round";
	const [left, right] = style.cap ? EDGE_GLYPHS[edges] : ["", ""];
	const pad = style.cap && edges === "sharp" ? NBSP : "";
	const capL = left ? `${style.cap}${left}\x1b[39m` : "";
	const capR = right ? `${style.cap}${right}\x1b[39m` : "";
	return `${capL}${style.label}\x1b[1m${pad}${text}${pad}\x1b[22;27m\x1b[39m\x1b[49m${capR}`;
}

/** Pills next to each other are separated by two spaces. */
const PILL_GAP = /\]\] \[\[/g;

// pi's Markdown reads "$" as the start of LaTeX math, and a later "*" makes it print the rest of the
// line raw. Before a digit, "$" is a currency sign: escape it, unless it opens math that pi draws.
const CURRENCY = /(^|[^\\$])\$(?=\d)/g;
const DOLLAR_OR_PILL = /\[\[[^\[\]\n]{1,32}\]\]|(?<![\\$])\$(?=\d)/g;

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
const escapeProse = (text: string) =>
	!text.includes("$") ? text : text.replace(DOLLAR_OR_PILL, (m: string, at: number) => (m !== "$" || opensMath(text, at) ? m : "\\$"));

const ACTION_OR_PILL = new RegExp(String.raw`\[\[[^\[\]\n]{1,32}\]\]|(\*\*)(${Object.keys(ACTION_ICONS).join("|")})(:\*\*)`, "gi");
const withActionIcons = (text: string) =>
	!text.includes("**") ? text : text.replace(ACTION_OR_PILL, (m: string, before?: string, word?: string, after?: string) =>
		word === undefined ? m : before + ACTION_ICONS[word.toLowerCase()] + " " + word + after,
	);

// A prose line without any of these marks draws as written: every step below leaves it unchanged.
const PROSE_MARKS = /\[\[|\*\*|__|\$|[✓✔✗✘→├└]/;
const GLYPHS = /[✓✔✗✘→├└]/;

function drawProse(line: string, literal: Range[], palette: Palette, open: string, close: string, drawn?: string[]): string {
	if (!PROSE_MARKS.test(line)) return line;
	const parts = partsOf(line, literal);
	if (!parts[0].literal) parts[0].text = parts[0].text.replace(LEAD_LABEL, (_, before: string, label: string, after: string) => before + withLabelIcon(label) + after);
	let result = "";
	let inBold: string | undefined;
	const reopen = () => (inBold ? `\x1b[1m${open}` : "");
	const glyphs = (text: string) => {
		if (!GLYPHS.test(text)) return text;
		const after = (m: string, color: Colorize) => color(m) + (inBold ? open : "");
		if (palette.passed) text = text.replace(/[✓✔]/g, (m) => after(m, palette.passed!));
		if (palette.failed) text = text.replace(/[✗✘]/g, (m) => after(m, palette.failed!));
		if (palette.arrow) text = text.replace(/→/g, (m) => after(m, palette.arrow!));
		if (palette.tree) text = text.replace(/[├└]──/g, (m) => after(m, palette.tree!));
		return text;
	};
	for (const part of parts) {
		if (part.literal) {
			// Pi's code color ends with a foreground reset; restore the bold color after it.
			result += inBold ? part.text + open : part.text;
			continue;
		}
		// Pills are read from the written text, before any escape or color is added around them.
		const prose = withActionIcons(escapeProse(part.text.includes("]] [[") ? part.text.replace(PILL_GAP, "]]  [[") : part.text));
		let last = 0;
		for (const m of prose.matchAll(INLINE)) {
			result += glyphs(prose.slice(last, m.index));
			last = m.index + m[0].length;
			const [match, slashes, marker, label] = m;
			if (label !== undefined) {
				if (!palette.pills || !label.trim()) result += match;
				else {
					drawn?.push(label);
					result += pill(label, palette) + reopen();
				}
			} else if ((slashes ?? "").length % 2 === 1) result += match; // escaped marker
			else if (!inBold) {
				inBold = marker;
				result += slashes + marker + open;
			} else if (inBold === marker) {
				inBold = undefined;
				result += slashes + close + marker;
			} else result += match;
		}
		result += glyphs(prose.slice(last));
	}
	// An unclosed span (streaming or literal asterisks) ends its color at the line end.
	if (inBold) result += close;
	return result;
}

/**
 * The reply_style section content. Pi wraps a section as <reply_style>\n…\n</reply_style>.
 * This is rule set c4g of the 2026-11-18 rules round (310 tokens on cpa/claude-opus-5-5, see DESIGN.md).
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
	pi.on("before_agent_start", (event) => {
		const sections = (event.systemPromptOptions.sections ??= {});
		if (currentTheme) sections.reply_style = REPLY_STYLE;
		else delete sections.reply_style;
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
