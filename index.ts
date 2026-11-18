// pi-emphasis: display-only emphasis for assistant replies in Pi's terminal.
//
//   **anchor term**   bold keeps its weight and takes a theme color (link blue)
//   ✓ / ✗             take the success and error colors
//   [[Blocked]]       becomes a rounded status pill colored by its word, with that word's icon
//
// Stored messages, copied text, and HTML exports keep the original Markdown.
// In the terminal interface it also adds a reply_style section to the system prompt, telling the
// model how to write these.
//
// Fork of https://github.com/johnlindquist/pi-emphasis at commit f884b73 (see README.md, "This fork").
// Keep the drawing code close to upstream so a sync stays a readable merge.
// Changes against upstream:
//   - The prompt section is the compact tested text REPLY_STYLE (289 tokens against 2,419 for
//     upstream's replyGuidance()). replyGuidance(), its helpers, CONTEXT_WORDS and the colorBold
//     alias are removed.
//   - The PI_EMPHASIS_GUIDANCE, PI_EMPHASIS_ROUND_CAPS, PI_EMPHASIS_PILL_ICONS and PI_EMPHASIS_COLOR
//     switches are removed; their defaults are fixed: rules on, round caps, icons on, bold in mdLink.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type Colorize = (text: string) => string;
export type PillTone = "success" | "error" | "warning" | "danger" | "mode" | "owner" | "neutral";

export interface Palette {
	/** Wraps bold text in a color. */
	bold: Colorize;
	passed?: Colorize;
	failed?: Colorize;
	/** Opening escapes for each pill tone: label colors and the cap color. */
	pills?: Record<PillTone, { label: string; cap: string }>;
	/** Colors for arrows and tree connectors. */
	arrow?: Colorize;
	tree?: Colorize;
	/** Rounded Nerd Font end caps; false draws square chips with a space on each side. */
	roundCaps?: boolean;
}

/** Minimal slice of Pi's Theme used to build a palette. */
export interface ThemeLike {
	fg(color: never, text: string): string;
	getFgAnsi(color: never): string;
	getBgAnsi(color: never): string;
}

/** Each tone's words. `core` are the words upstream's guidance listed; `also` are accepted and colored the same. */
export const VOCABULARY: Record<Exclude<PillTone, "neutral">, { core: string[]; also: string[] }> = {
	error: { core: ["Failed", "Blocked", "Broken", "Unsafe"], also: ["fail", "failing", "error", "rejected", "down"] },
	warning: { core: ["Needs you", "Decision", "Unverified", "Partial", "Skipped", "In progress", "Pending", "At risk"], also: ["needs review", "waiting", "review", "todo", "stale", "draft"] },
	success: { core: ["Done", "Passed", "Observed", "Fixed", "Live", "Recommended", "Keep"], also: ["pass", "ready", "merged", "safe", "verified", "shipped", "ok", "approved", "complete", "completed", "finished", "healthy"] },
	danger: { core: ["Costs money", "Destructive", "Irreversible"], also: [] },
	mode: { core: ["Brainstorm", "Investigate", "Preview", "Implement", "Qualify"], also: [] },
	owner: { core: ["Owned", "Shared", "Foreign"], also: [] },
};
const TONE_WORDS = Object.fromEntries(
	Object.entries(VOCABULARY).map(([tone, words]) => [tone, [...words.core, ...words.also].map((w) => w.toLowerCase())]),
) as Record<Exclude<PillTone, "neutral">, string[]>;

// Font Awesome glyphs from the Nerd Font set: one cell wide in every terminal.
const CHECK = "\uf00c";
const CROSS = "\uf00d";
const CLOCK = "\uf017";
/** The icon each known pill word carries. Words without an entry stay text-only. */
const PILL_ICONS: Record<string, string> = {
	done: CHECK, passed: CHECK, pass: CHECK, complete: CHECK, completed: CHECK, ok: CHECK, verified: CHECK,
	observed: "\uf06e", recommended: "\uf005", fixed: "\uf0ad", live: "\uf135", shipped: "\uf135", approved: "\uf164",
	failed: CROSS, fail: CROSS, failing: CROSS, error: CROSS, rejected: CROSS,
	blocked: "\uf05e", broken: "\uf127", unsafe: "\uf132", down: "\uf063",
	"needs you": "\uf007", decision: "\uf126", unverified: "\uf128", "at risk": "\uf071",
	"in progress": "\uf110", pending: CLOCK, waiting: CLOCK, partial: "\uf042", skipped: "\uf04e",
	inferred: "\uf0eb", new: "\uf067", changed: "\uf040", optional: "\uf10c", "costs money": "\uf155",
	destructive: "\uf1f8", irreversible: "\uf023", review: "\uf06e", stale: "\uf1da", draft: "\uf044", safe: "\uf132",
	brainstorm: "\uf0eb", investigate: "\uf002", preview: "\uf06e", implement: "\uf0ad", qualify: "\uf0c3",
	owned: "\uf007", shared: "\uf0c0", foreign: "\uf023",
	keep: "\uf08d", ready: CHECK, merged: "\uf126", healthy: "\uf004", todo: "\uf0ae",
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

// A label may open with its own Private Use Area glyph, which wins over the table's icon.
const OWN_ICON = /^\s*([\ue000-\uf8ff]|[\u{f0000}-\u{ffffd}])\s*/u;

const KNOWN = [...new Set([...Object.values(TONE_WORDS).flat(), ...Object.keys(PILL_ICONS), ...Object.keys(SYNONYMS)])].sort((a, b) => b.length - a.length);

/** A pill label read as its word: a known word may be followed by detail ("Passed 12/12", "Failed: 3 tests"). */
function splitLabel(label: string): { icon: string | undefined; word: string; key: string } {
	const own = label.match(OWN_ICON);
	const text = (own ? label.slice(own[0].length) : label).replace(/\s+/g, " ").trim();
	const lower = text.toLowerCase();
	const known = KNOWN.find((k) => lower === k || (lower.startsWith(k) && /[ :]/.test(lower[k.length])));
	const canonical = known ? SYNONYMS[known] : undefined;
	const key = (canonical ?? known ?? lower).toLowerCase();
	const word = canonical && known ? canonical + text.slice(known.length) : text;
	return { icon: own?.[1] ?? PILL_ICONS[key], word, key };
}

export function toneOf(label: string): PillTone {
	const { key } = splitLabel(label);
	for (const tone of ["danger", "error", "warning", "success", "mode", "owner"] as const) {
		if (TONE_WORDS[tone].includes(key)) return tone;
	}
	return "neutral";
}

/** A background escape turned into the same color as a foreground, for pill caps. */
function bgToFg(bg: string): string {
	return bg.replace(/\x1b\[48;/g, "\x1b[38;").replace(/\x1b\[(4|10)([0-7])m/g, (_, p: string, n: string) => `\x1b[${p === "4" ? "3" : "9"}${n}m`);
}

const solid = (code: number) => ({ label: `\x1b[${code}m\x1b[7m`, cap: `\x1b[${code}m` });

export function createPalette(theme: ThemeLike, boldColor = "mdLink"): Palette {
	const fg = (name: string) => (text: string) => theme.fg(name as never, text);
	const tone = (labelFg: string, bg: string) => {
		const bgAnsi = theme.getBgAnsi(bg as never);
		// A theme without its own panel colors (Pi's system theme when the terminal reports
		// none) draws pills in reverse video: the tone's color becomes the background.
		if (!bgAnsi || /^\x1b\[49m$/.test(bgAnsi)) {
			const fgAnsi = theme.getFgAnsi((labelFg === "text" ? "accent" : labelFg) as never);
			return { label: `${fgAnsi}\x1b[7m`, cap: fgAnsi };
		}
		return { label: bgAnsi + theme.getFgAnsi(labelFg as never), cap: bgToFg(bgAnsi) };
	};
	return {
		bold: fg(boldColor),
		passed: fg("success"),
		failed: fg("error"),
		pills: {
			success: tone("success", "toolSuccessBg"),
			error: tone("error", "toolErrorBg"),
			warning: tone("warning", "searchMatchBg"),
			neutral: tone("text", "selectedBg"),
			// Solid chips in the terminal's own magenta, cyan and blue: louder than the panel-colored tones.
			danger: solid(31),
			mode: solid(36),
			owner: solid(34),
		},
		arrow: fg("accent"),
		tree: fg("dim"),
		roundCaps: true,
	};
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
// Escaped bold markers, bold markers, or a [[pill]] of 1-32 characters.
const INLINE = /(\\*)(\*\*|__)|\[\[([^\[\]\n]{1,32})\]\]/g;

/** Apply colors to assistant Markdown, leaving code blocks, inline code and headings alone. */
export function decorate(markdown: string, palette: Palette): string {
	const [open, close] = palette.bold("\u0000").split("\u0000") as [string, string];
	const out: string[] = [];
	let fence: string | undefined;
	for (const line of markdown.split("\n")) {
		const fenceMatch = line.match(FENCE);
		if (fence) {
			if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = undefined;
			out.push(line);
		} else if (fenceMatch) {
			fence = fenceMatch[1];
			out.push(line);
		} else if (/^ {0,3}#{1,6}\s/.test(line)) {
			out.push(line.replace(/^( {0,3}#{1,6}\s+)(.+)$/, (_, hashes: string, title: string) => hashes + withLabelIcon(title))); // Pi already colors headings.
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
	const icon = LABEL_ICONS[word] ?? (label.trimEnd().endsWith(":") ? ACTION_ICONS[word] : undefined);
	return icon ? `${icon} ${label}` : label;
}

// A line's leading bold label, after an optional list marker or tree connector.
const LEAD_LABEL = /^(\s*(?:[-*+]|\d+\.)?\s*(?:[├└]──\s*)?\*\*)([^*`\n]{1,32})(\*\*)/;

function pill(label: string, palette: Palette): string {
	const style = palette.pills![toneOf(label)];
	// No-break spaces keep a two-word pill on one line when Pi wraps the paragraph.
	const { icon, word } = splitLabel(label);
	const text = (icon && word ? `${icon} ${word}` : word || label.trim()).replace(/ /g, "\u00a0");
	const [left, right] = palette.roundCaps ? ["\ue0b6", "\ue0b4"] : ["", ""];
	const pad = palette.roundCaps ? "" : "\u00a0";
	const capL = left ? `${style.cap}${left}\x1b[39m` : "";
	const capR = right ? `${style.cap}${right}\x1b[39m` : "";
	return `${capL}${style.label}\x1b[1m${pad}${text}${pad}\x1b[22;27m\x1b[39m\x1b[49m${capR}`;
}

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
		let prose = part;
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
 * The reply_style section content. Pi wraps a section as <reply_style>\n…\n</reply_style>, so the
 * section the model reads is the tested rules-b2.txt word for word. Every label, pill and lead-in
 * word here must stay a known word of the tables above (test/reply-style.test.ts checks this).
 */
export const REPLY_STYLE = `The terminal draws [[Word]] as a colored pill and gives a bold lead label an icon.
- Label: open every reply, and each subject of a long reply, with a bold label: Result, Status, Cause, Fix, Risk, Next, Plan, Evidence, Decision.
- Pill: put one beside the subject whose state it names, with only these words: [[Done]] [[Passed]] [[Fixed]] [[Failed]] [[Blocked]] [[In progress]] [[Unverified]] [[Needs you]] [[Decision]] [[Destructive]] [[Costs money]].
- Action: follow every pill except Done, Passed and Fixed with the one step that resolves it, led by a bold Do:, Check:, Next:, Unblock: or Undo:.
- Keep pills out of code, paths and commands.`;

export default function emphasis(pi: ExtensionAPI) {
	let currentTheme: (() => ThemeLike) | undefined;
	let built: { theme: ThemeLike; palette: Palette } | undefined;
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		currentTheme = () => ctx.ui.theme as unknown as ThemeLike;
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
		if (built?.theme !== theme) built = { theme, palette: createPalette(theme) };
		return decorate(markdown, built.palette);
	});
}
