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
// The design of this fork's look and rules is DESIGN.md; every setting is in docs/configuration.md.
// Changes against upstream:
//   - The prompt section is the compact tested text REPLY_STYLE (358 tokens against 2,419 for
//     upstream's replyGuidance()).
//   - Needs you and Decision have their own tone, "ask", drawn solid.
//   - Pill colors are tinted panels taken from the current pi theme; icons are one family of
//     same-size Material Design circles; a count line of the reply's pills is drawn under the
//     first paragraph.
//   - The PI_EMPHASIS_* environment switches are gone. An optional "emphasis" block in pi's
//     settings.json sets edges, icons, label color, tone colors and fill (readSettings()).
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type Colorize = (text: string) => string;
export type PillTone = "success" | "error" | "warning" | "ask" | "danger" | "mode" | "owner" | "neutral";
export type Edges = "round" | "half" | "sharp";
export type IconSet = "filled" | "outline" | "none";
export type Fill = "panel" | "solid" | "text";

/** The optional "emphasis" block of pi's settings.json. docs/configuration.md describes each field. */
export interface EmphasisSettings {
	edges: Edges;
	icons: IconSet;
	/** Color of bold labels, lead-ins and bold text: a pi theme color name or "#rrggbb". */
	labels: string;
	/** Per tone: a pi theme color name or "#rrggbb". */
	colors: Record<PillTone, string>;
	fill: Record<PillTone, Fill>;
}

const TONES: PillTone[] = ["success", "error", "warning", "ask", "danger", "mode", "owner", "neutral"];
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

export interface PillStyle {
	/** Opening escapes of the pill's body. */
	label: string;
	/** Foreground escape that draws the edges in the body's color; empty for a pill without edges. */
	cap: string;
}

export interface Palette {
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
	/** Draw the count line of the reply's pills under the first paragraph. */
	countLine?: boolean;
}

/** Minimal slice of Pi's Theme used to build a palette. */
export interface ThemeLike {
	fg(color: never, text: string): string;
	getFgAnsi(color: never): string;
	getBgAnsi(color: never): string;
	getColorMode?(): string;
}

/** Each tone's words. `core` are the words the tones were defined with; `also` are accepted and colored the same. */
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
export const ICON_SETS: Record<Exclude<IconSet, "none">, Record<string, string>> = {
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

/** A pill label read as its word: a known word may be followed by detail ("Passed 12/12", "Failed: 3 tests"). */
function splitLabel(label: string, icons?: Record<string, string>): { icon: string | undefined; word: string; key: string } {
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

export function toneOf(label: string): PillTone {
	const { key } = splitLabel(label);
	for (const tone of ["danger", "error", "ask", "warning", "success", "mode", "owner"] as const) {
		if (TONE_WORDS[tone].includes(key)) return tone;
	}
	return "neutral";
}

/** A background escape turned into the same color as a foreground, for pill caps. */
function bgToFg(bg: string): string {
	return bg.replace(/\x1b\[48;/g, "\x1b[38;").replace(/\x1b\[(4|10)([0-7])m/g, (_, p: string, n: string) => "\x1b[" + (p === "4" ? "3" : "9") + n + "m");
}

type RGB = [number, number, number];
const rgbOf = (ansi: string): RGB | undefined => {
	const m = ansi.match(/\x1b\[(?:38|48);2;(\d+);(\d+);(\d+)m/);
	return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
};
const hexRgb = (hex: string): RGB => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as RGB;
/** The share of the tone color in a panel's background; the rest is the theme's toolPendingBg. */
export const PANEL_MIX = 0.22;
const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => Math.round(a[i] * t + b[i] * (1 - t))) as RGB;
const fgRgb = (c: RGB) => "\x1b[38;2;" + c.join(";") + "m";
const bgRgb = (c: RGB) => "\x1b[48;2;" + c.join(";") + "m";
/** WCAG relative luminance and contrast ratio, to pick readable text on a solid pill. */
const luminance = (c: RGB) => {
	const [r, g, b] = c.map((v) => {
		const s = v / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: RGB, b: RGB) => {
	const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
	return (x + 0.05) / (y + 0.05);
};
/** The index of the xterm-256 color cube nearest to a color, for hex colors in a 256-color terminal. */
function xterm256(c: RGB): number {
	const steps = [0, 95, 135, 175, 215, 255];
	const near = (v: number) => steps.reduce((best, s, i) => (Math.abs(s - v) < Math.abs(steps[best] - v) ? i : best), 0);
	const [r, g, b] = c.map(near);
	return 16 + 36 * r + 6 * g + b;
}

// Tool backgrounds for terminals without truecolor, as upstream drew them.
const LEGACY_BG: Record<PillTone, string> = {
	success: "toolSuccessBg", error: "toolErrorBg", warning: "searchMatchBg", ask: "searchMatchBg", danger: "toolErrorBg", mode: "selectedBg", owner: "selectedBg", neutral: "selectedBg",
};

export function createPalette(theme: ThemeLike, settings: EmphasisSettings = DEFAULT_SETTINGS): Palette {
	const truecolor = !theme.getColorMode || theme.getColorMode() === "truecolor";
	// Pi's theme throws on a color name it does not know ("teal"); such a setting falls back to its default.
	const known = (name: string) => {
		try {
			theme.getFgAnsi(name as never);
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
	const fg = (name: string) => (text: string) => theme.fg(name as never, text);
	const fgOf = (spec: string) =>
		!spec.startsWith("#") ? theme.getFgAnsi(spec as never) : truecolor ? fgRgb(hexRgb(spec)) : "\x1b[38;5;" + xterm256(hexRgb(spec)) + "m";
	/** A color spec as RGB, when the terminal draws truecolor and the theme gives one. */
	const rgb = (spec: string): RGB | undefined => (!truecolor ? undefined : spec.startsWith("#") ? hexRgb(spec) : rgbOf(theme.getFgAnsi(spec as never)));
	const base = rgbOf(theme.getBgAnsi("toolPendingBg" as never));
	const text = rgbOf(theme.getFgAnsi("text" as never));

	const style = (tone: PillTone): PillStyle => {
		const spec = settings.colors[tone];
		const fill = settings.fill[tone];
		if (fill === "text") return { label: fgOf(spec), cap: "" };
		const c = rgb(spec);
		if (c && base) {
			if (fill === "solid") {
				const ink = text && contrast(text, c) > contrast(base, c) ? text : base;
				return { label: bgRgb(c) + fgRgb(ink), cap: fgRgb(c) };
			}
			const p = mix(c, base, PANEL_MIX);
			return { label: bgRgb(p) + fgRgb(c), cap: fgRgb(p) };
		}
		// No RGB (a 256-color terminal, or a theme without panel colors): solid pills, and panels in
		// a theme without its own panel colors, draw in reverse video with the tone's color as background.
		const bgAnsi = theme.getBgAnsi(LEGACY_BG[tone] as never);
		if (fill === "solid" || !bgAnsi || /^\x1b\[49m$/.test(bgAnsi)) {
			const f = fgOf(tone === "neutral" && spec === "text" ? "accent" : spec);
			return { label: f + "\x1b[7m", cap: f };
		}
		return { label: bgAnsi + fgOf(spec), cap: bgToFg(bgAnsi) };
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
		countLine: true,
	};
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
// Escaped bold markers, bold markers, or a [[pill]] of 1-32 characters.
const INLINE = /(\\*)(\*\*|__)|\[\[([^\[\]\n]{1,32})\]\]/g;
const PILL = /\[\[([^\[\]\n]{1,32})\]\]/g;
const CODE_SPAN = /`+[^`]*?`+/g;
// A written scoreboard: a line of two or more pills and nothing else.
const PILLS_ONLY = /^\s*\[\[[^\[\]\n]{1,32}\]\](?:\s*\[\[[^\[\]\n]{1,32}\]\])+\s*$/;
/** The fewest state pills (ask, error, warning or success) a reply needs for a count line. */
export const COUNT_LINE_MIN = 5;
const COUNT_ORDER: PillTone[] = ["ask", "error", "warning", "success"];
const DISPLAY = Object.fromEntries(
	Object.values(VOCABULARY)
		.flatMap((w) => [...w.core, ...w.also])
		.map((w) => [w.toLowerCase(), w[0].toUpperCase() + w.slice(1)]),
);

/**
 * The count line of a reply: one pill per state word with its count, asks first. Undefined when the
 * reply has fewer than COUNT_LINE_MIN state pills, only one state word, or a line of only pills already.
 */
export function countLine(markdown: string): string | undefined {
	const tally = new Map<string, number>();
	let fence: string | undefined;
	let total = 0;
	for (const line of markdown.split("\n")) {
		const f = line.match(FENCE);
		if (fence) {
			if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = undefined;
			continue;
		}
		if (f) {
			fence = f[1];
			continue;
		}
		if (/^ {0,3}#{1,6}\s/.test(line)) continue;
		const prose = line.replace(CODE_SPAN, "");
		if (PILLS_ONLY.test(prose)) return undefined;
		for (const m of prose.matchAll(PILL)) {
			const tone = toneOf(m[1]);
			if (!COUNT_ORDER.includes(tone)) continue;
			const { key } = splitLabel(m[1]);
			tally.set(key, (tally.get(key) ?? 0) + 1);
			total++;
		}
	}
	if (total < COUNT_LINE_MIN || tally.size < 2) return undefined;
	return [...tally.keys()]
		.sort((a, b) => COUNT_ORDER.indexOf(toneOf(a)) - COUNT_ORDER.indexOf(toneOf(b)))
		.map((k) => "[[" + (own(DISPLAY, k) ?? k) + " " + tally.get(k) + "]]")
		.join(" ");
}

const LIST_ITEM = /^\s*(?:[-*+]|\d+\.)\s/;
/**
 * The count line goes after the reply's first paragraph, unless that paragraph holds a code fence.
 * A reply that opens with a list takes it above the list, so it never splits the list's items.
 */
function withCountLine(markdown: string): string {
	const line = countLine(markdown);
	if (!line) return markdown;
	const lines = markdown.split("\n");
	const first = lines.findIndex((l) => l.trim());
	if (LIST_ITEM.test(lines[first])) return [...lines.slice(0, first), line, "", ...lines.slice(first)].join("\n");
	let end = lines.findIndex((l, i) => i > first && !l.trim());
	if (end < 0) end = lines.length;
	if (lines.slice(first, end).some((l) => FENCE.test(l))) return markdown;
	return [...lines.slice(0, end), "", line, ...lines.slice(end)].join("\n");
}

/** Apply colors to assistant Markdown, leaving code blocks, inline code and headings alone. */
export function decorate(markdown: string, palette: Palette, streaming = false): string {
	// The count line waits for the whole reply: drawn while streaming, it would move the text below it.
	const source = palette.countLine && !streaming ? withCountLine(markdown) : markdown;
	const [open, close] = palette.bold("\u0000").split("\u0000") as [string, string];
	const out: string[] = [];
	let fence: string | undefined;
	for (const line of source.split("\n")) {
		const fenceMatch = line.match(FENCE);
		if (fence) {
			if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = undefined;
			out.push(line);
		} else if (fenceMatch) {
			fence = fenceMatch[1];
			out.push(line);
		} else if (/^ {0,3}#{1,6}\s/.test(line)) {
			// Pi already colors headings.
			out.push(line.replace(/^( {0,3}#{1,6}\s+)(.+)$/, (_, hashes: string, title: string) => hashes + escapeCurrency(withLabelIcon(title))));
		} else {
			out.push(decorateLine(line, palette, open, close));
		}
	}
	return out.join("\n");
}

/** Lead-in words that name the action a pill calls for. With a colon they take an icon anywhere in a line. */
const ACTION_ICONS: Record<string, string> = {
	check: "\uf046", do: "\uf0a4", next: "\uf061", unblock: "\uf09c", left: "\uf141", run: "\uf04b", guard: "\uf132", undo: "\uf0e2", see: "\uf08e",
};
const ACTION_LABEL = new RegExp(`(\\*\\*)(${Object.keys(ACTION_ICONS).join("|")})(:\\*\\*)`, "gi");

/** Prefix a known label with its icon, unless it already opens with a glyph. */
function withLabelIcon(label: string): string {
	if (OWN_ICON.test(label)) return label;
	const word = label.replace(/[:\s]+$/, "").trim().toLowerCase();
	const icon = own(LABEL_ICONS, word) ?? (label.trimEnd().endsWith(":") ? own(ACTION_ICONS, word) : undefined);
	return icon ? `${icon} ${label}` : label;
}

// A line's leading bold label, after an optional list marker, tree connector, or kind-of-work pill.
const LEAD_LABEL = /^(\s*(?:[-*+]|\d+\.)?\s*(?:[├└]──\s*)?(?:\[\[[^\[\]\n]{1,32}\]\]\s*)?\*\*)([^*`\n]{1,32})(\*\*)/;

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

function pill(label: string, palette: Palette): string {
	const style = palette.pills![toneOf(label)];
	// No-break spaces keep a two-word pill on one line when Pi wraps the paragraph.
	const { icon, word } = splitLabel(label, palette.icons);
	const text = icon && word ? icon + ICON_SPACE + word.replace(/ /g, NBSP) : (word || label.trim()).replace(/ /g, NBSP);
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
// line raw. Before a digit, "$" is a currency sign: escape it.
const CURRENCY = /(^|[^\\$])\$(?=\d)/g;
const escapeCurrency = (text: string) => text.replace(CURRENCY, (_, before: string) => before + "\\$");

function decorateLine(line: string, palette: Palette, open: string, close: string): string {
	// Odd parts are inline code spans, which stay untouched.
	const parts = line.replace(LEAD_LABEL, (_, before: string, label: string, after: string) => before + withLabelIcon(label) + after).split(/(`+[^`]*?`+)/g);
	let result = "";
	let inBold: string | undefined;
	const reopen = () => (inBold ? `\x1b[1m${open}` : "");
	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		if (i % 2 === 1) {
			// Pi's code color ends with a foreground reset; restore the bold color after it.
			result += inBold ? `${part}${open}` : part;
			continue;
		}
		let prose = escapeCurrency(part).replace(PILL_GAP, "]]  [[");
		prose = prose.replace(ACTION_LABEL, (_, before: string, word: string, after: string) => `${before}${ACTION_ICONS[word.toLowerCase()]} ${word}${after}`);
		if (palette.passed) prose = prose.replace(/[✓✔]/g, (m) => palette.passed!(m) + (inBold ? open : ""));
		if (palette.failed) prose = prose.replace(/[✗✘]/g, (m) => palette.failed!(m) + (inBold ? open : ""));
		if (palette.arrow) prose = prose.replace(/→/g, (m) => palette.arrow!(m) + (inBold ? open : ""));
		if (palette.tree) prose = prose.replace(/[├└]──/g, (m) => palette.tree!(m) + (inBold ? open : ""));
		result += prose.replace(INLINE, (match, slashes: string | undefined, marker: string | undefined, label: string | undefined) => {
			if (label !== undefined) {
				if (!palette.pills || !label.trim()) return match;
				return pill(label, palette) + reopen();
			}
			if ((slashes ?? "").length % 2 === 1) return match; // escaped marker
			if (!inBold) {
				inBold = marker;
				return `${slashes}${marker}${open}`;
			}
			if (inBold === marker) {
				inBold = undefined;
				return `${slashes}${close}${marker}`;
			}
			return match;
		});
	}
	// An unclosed span (streaming or literal asterisks) ends its color at the line end.
	if (inBold) result += close;
	return result;
}

/**
 * The reply_style section content. Pi wraps a section as <reply_style>\n…\n</reply_style>.
 * This is rule set c3 of the 2026-11-18 evaluation (358 tokens on cpa/claude-opus-5-5, see DESIGN.md).
 * Every kind, pill and lead-in word here must stay a known word of the tables above
 * (test/reply-style.test.ts checks this).
 */
export const REPLY_STYLE = `The terminal draws [[Word]] as a colored pill and gives a bold lead label an icon.
- Open with a bold label: **Result:** ... When the reply has several subjects, put a kind-of-work pill first: [[Implement]] **Result:** ... Kinds: Brainstorm, Investigate, Preview, Implement, Qualify.
- Long reply: a ## heading per group; each bullet **Subject** [[Pill]] text.
- Pills: [[Done]] [[Passed]] [[Fixed]] [[Observed]] [[Recommended]] [[Failed]] [[Blocked]] [[Partial]] [[In progress]] [[Unverified]] [[At risk]] [[Needs you]] [[Decision]] [[Destructive]] [[Costs money]] [[Shared]].
- After a pill, the step that resolves it, led by a bold Do:, Check:, Next:, Unblock:, Left:, Guard:, Undo: or See:.
- Keep pills out of code, paths and commands.`;

export default function emphasis(pi: ExtensionAPI) {
	let currentTheme: (() => ThemeLike) | undefined;
	let settings = DEFAULT_SETTINGS;
	let built: { theme: ThemeLike; palette: Palette } | undefined;
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		currentTheme = () => ctx.ui.theme as unknown as ThemeLike;
		// Read once per session start; /reload picks up a change.
		settings = readSettings((pi.getSettings() as { emphasis?: unknown }).emphasis);
		built = undefined;
	});
	// The rules travel with the renderer: only a session that draws pills is told to write them.
	pi.on("before_agent_start", (event) => {
		const sections = (event.systemPromptOptions.sections ??= {});
		if (currentTheme) sections.reply_style = REPLY_STYLE;
		else delete sections.reply_style;
	});
	pi.registerMarkdownTransformer((markdown, context) => {
		if (!currentTheme || context.messageType !== "assistant") return markdown;
		// Rebuild when the theme changes, so /theme switches recolor new output.
		const theme = currentTheme();
		if (built?.theme !== theme) built = { theme, palette: createPalette(theme, settings) };
		return decorate(markdown, built.palette, context.isStreaming === true);
	});
}
