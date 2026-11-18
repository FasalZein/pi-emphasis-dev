// Property tests (Hegel) for the pure parts of the renderer: settings parsing, the count line, and
// what decorate leaves untouched.
import { expect, test } from "bun:test";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { Markdown, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { Marked, type Token } from "marked";
import { DEFAULT_SETTINGS, VOCABULARY, countLine, createPalette, decorate, readSettings } from "../index.ts";

const TONES = ["success", "error", "warning", "ask", "danger", "mode", "owner", "neutral"] as const;
const COLOR = /^(#[0-9a-fA-F]{6}|[A-Za-z][A-Za-z0-9]*)$/;

// Values a hand-written settings block may hold: valid ones, near misses and other JSON types.
const value = gs.oneOf<unknown>(
	gs.sampledFrom(["round", "half", "sharp", "filled", "outline", "none", "panel", "solid", "text", "accent", "#ff966c", "#FF966C"]),
	gs.sampledFrom(["", "Round", "#ff966", "#gggggg", "1abc", "warning color", "rgb(1,2,3)"]),
	gs.integers({ minValue: -3, maxValue: 3 }),
	gs.booleans(),
	gs.none(),
	gs.arrays(gs.text({ maxSize: 4 }), { maxSize: 2 }),
);
const toneMap = gs.oneOf<unknown>(
	gs.record({ success: value, ask: value, neutral: value, extra: value }),
	value,
);

test("readSettings keeps a valid field and replaces any other value with the default", () =>
	hegel.test((tc) => {
		const raw = tc.draw(gs.oneOf<unknown>(gs.record({ edges: value, icons: value, labels: value, colors: toneMap, fill: toneMap }), value));
		const s = readSettings(raw);
		const r = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
		const keep = (v: unknown, ok: (x: string) => boolean, d: string) => (typeof v === "string" && ok(v) ? v : d);
		expect(s.edges).toBe(keep(r.edges, (x) => ["round", "half", "sharp"].includes(x), DEFAULT_SETTINGS.edges) as never);
		expect(s.icons).toBe(keep(r.icons, (x) => ["filled", "outline", "none"].includes(x), DEFAULT_SETTINGS.icons) as never);
		expect(s.labels).toBe(keep(r.labels, (x) => COLOR.test(x), DEFAULT_SETTINGS.labels));
		const colors = (r.colors && typeof r.colors === "object" && !Array.isArray(r.colors) ? r.colors : {}) as Record<string, unknown>;
		const fill = (r.fill && typeof r.fill === "object" && !Array.isArray(r.fill) ? r.fill : {}) as Record<string, unknown>;
		for (const t of TONES) {
			expect(s.colors[t]).toBe(keep(colors[t], (x) => COLOR.test(x), DEFAULT_SETTINGS.colors[t]));
			expect(s.fill[t]).toBe(keep(fill[t], (x) => ["panel", "solid", "text"].includes(x), DEFAULT_SETTINGS.fill[t]) as never);
		}
		expect(Object.keys(s.colors).sort()).toEqual([...TONES].sort());
	}));

// The count line's oracle, built from VOCABULARY rather than from the renderer's own tone lookup.
const STATE = ["ask", "error", "warning", "success"] as const;
const stateWords = STATE.flatMap((t) => VOCABULARY[t].core.map((w) => [w, t] as const));
const otherWords = [...VOCABULARY.mode.core, ...VOCABULARY.danger.core, ...VOCABULARY.owner.core, "Inferred", "Anything"];
const pillWord = gs.oneOf(gs.sampledFrom(stateWords.map(([w]) => w)), gs.sampledFrom(otherWords));
const placed = gs.record({ word: pillWord, inCode: gs.booleans() });

test("the count line counts every state pill outside code, asks first, when there are 5 or more of 2 words", () =>
	hegel.test((tc) => {
		const bullets = tc.draw(gs.arrays(gs.arrays(placed, { maxSize: 3 }), { maxSize: 12 }));
		const md = ["**Result:** x", "", ...bullets.map((ps) => "- item " + ps.map((p) => (p.inCode ? "\x60[[" + p.word + "]]\x60" : "[[" + p.word + "]]")).join(" text "))].join("\n");
		const tally = new Map<string, number>();
		for (const p of bullets.flat()) {
			if (p.inCode) continue;
			if (stateWords.some(([w]) => w === p.word)) tally.set(p.word, (tally.get(p.word) ?? 0) + 1);
		}
		const total = [...tally.values()].reduce((a, b) => a + b, 0);
		const tone = (w: string) => STATE.indexOf(stateWords.find(([x]) => x === w)![1]);
		const expected = total >= 5 && tally.size >= 2
			? [...tally.keys()].sort((a, b) => tone(a) - tone(b)).map((w) => "[[" + w + " " + tally.get(w) + "]]").join(" ")
			: undefined;
		expect(countLine(md)).toBe(expected);
	}));

const theme = {
	fg: (c: string, t: string) => "<" + c + ">" + t + "</>",
	getFgAnsi: (c: string) => "\x1b[38;fg-" + c + "m",
	getBgAnsi: (c: string) => "\x1b[48;bg-" + c + "m",
} as never;
const palette = createPalette(theme);
const codeText = gs.text({ alphabet: "ab [*]$\\_D1:→✓├─#", minSize: 1, maxSize: 16 });

test("words that name inherited object members are no table entries", () =>
	hegel.test((tc) => {
		const word = tc.draw(gs.sampledFrom(["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf", "isPrototypeOf"]));
		const shape = tc.draw(gs.sampledFrom(["## W", "**W:** x", "- **W** x", "x [[W]]", "[[W 3]]", "x\n\n- [[W]]\n- [[Done]]\n- [[Done]]\n- [[Failed]]\n- [[W]]\n- [[Failed]]"]));
		const md = shape.replaceAll("W", word);
		const out = decorate(md, palette);
		expect(out).not.toContain("function");
		expect(out).not.toContain("[object");
		expect(countLine(md) ?? "").not.toContain("function");
	}));

test("an unknown theme color name never stops the drawing and falls back to the tone's default", () =>
	hegel.test((tc) => {
		const known = new Set(["success", "error", "warning", "accent", "customMessageLabel", "text", "thinkingMinimal", "dim", "mdLink"]);
		const strict = {
			fg: (c: string, t: string) => { if (!known.has(c)) throw new Error("Unknown theme color: " + c); return "<" + c + ">" + t + "</>"; },
			getFgAnsi: (c: string) => { if (!known.has(c)) throw new Error("Unknown theme color: " + c); return "\x1b[38;fg-" + c + "m"; },
			getBgAnsi: (c: string) => "\x1b[48;bg-" + c + "m",
		} as never;
		const name = tc.draw(gs.oneOf(gs.sampledFrom([...known]), gs.text({ alphabet: "abcteal", minSize: 1, maxSize: 8 })));
		const tone = tc.draw(gs.sampledFrom(["success", "error", "warning", "ask", "danger", "mode", "owner", "neutral"] as const));
		const settings = readSettings({ labels: name, colors: { [tone]: name } });
		const word = { success: "Done", error: "Failed", warning: "Partial", ask: "Needs you", danger: "Destructive", mode: "Implement", owner: "Shared", neutral: "Anything" }[tone];
		const out = decorate("**Cause:** [[" + word + "]]", createPalette(strict, settings));
		const expected = decorate("**Cause:** [[" + word + "]]", createPalette(strict, known.has(name) ? settings : DEFAULT_SETTINGS));
		expect(out).toBe(expected);
	}));

// pi's own wrapper (pi-tui) breaks lines at U+0020 only; a pill's icon and its word must stay on one line.
const ICON_GLYPH = /[\u{f0000}-\u{ffffd}]/u;
test("pi's line wrapping never ends a line on a pill icon", () =>
	hegel.test((tc) => {
		const words = tc.draw(gs.arrays(gs.sampledFrom(["Done", "Needs you", "In progress", "Costs money", "Failed", "Partial"]), { minSize: 1, maxSize: 6 }));
		const width = tc.draw(gs.integers({ minValue: 12, maxValue: 60 }));
		const line = decorate("- **Subject** " + words.map((w) => "[[" + w + "]] some words").join(" "), palette);
		for (const row of wrapTextWithAnsi(line, width)) {
			const visible = row.replace(/\x1b\[[0-9;a-zA-Z-]*m/g, "").trimEnd();
			expect(ICON_GLYPH.test(visible.slice(-2))).toBe(false);
		}
	}));

test("the icon space is one cell wide for pi", () => expect(visibleWidth("\u2002")).toBe(1));

test("decorate leaves inline code spans byte for byte", () =>
	hegel.test((tc) => {
		const code = tc.draw(codeText);
		const before = tc.draw(gs.sampledFrom(["", "**Fix:** ", "- **Build** [[Passed]] ", "saves $20 "]));
		const line = before + "\x60" + code + "\x60" + " after [[Done]]";
		expect(decorate(line, palette)).toContain("\x60" + code + "\x60");
	}));

test("decorate leaves fenced code lines byte for byte", () =>
	hegel.test((tc) => {
		const body = tc.draw(gs.arrays(codeText, { minSize: 1, maxSize: 4 }));
		const md = ["**Result:** x", "\x60\x60\x60", ...body, "\x60\x60\x60"].join("\n");
		expect(decorate(md, palette).split("\n").slice(1)).toEqual(md.split("\n").slice(1));
	}));

// Items 1 and 2 of the 2026-11-18 review round. A reply is built from blocks whose pills are either in
// prose or in code (inline, fenced, fenced in a quote or a list, indented, tab-indented) or in a hidden
// HTML comment. The oracle is the generator's own record of which pills are prose.
const ansiTheme = {
	fg: (c: string, t: string) => "\x1b[38;5;" + (c.length % 200) + "m" + t + "\x1b[39m",
	getFgAnsi: (c: string) => "\x1b[38;5;" + (c.length % 200) + "m",
	getBgAnsi: (c: string) => "\x1b[48;5;" + (c.length % 200) + "m",
	getColorMode: () => "256color",
} as never;
const ansi = createPalette(ansiTheme);
const PILL_END = /\x1b\[22;27m/g;
const drawnCount = (out: string) => (out.match(PILL_END) ?? []).length;

interface Block { text: string; prose: string[]; code: string[] }
const BLOCKS: ((w: string, v: string) => Block)[] = [
	(w) => ({ text: "- **S** [[" + w + "]] text", prose: [w], code: [] }),
	(w) => ({ text: "1) S [[" + w + "]] text", prose: [w], code: [] }),
	(w, v) => ({ text: "[[" + w + "]] \x60x\x60 [[" + v + "]]", prose: [w, v], code: ["\x60x\x60"] }),
	(w) => ({ text: "- s \x60[[" + w + "]]\x60 t", prose: [], code: ["\x60[[" + w + "]]\x60"] }),
	(w) => ({ text: "- [[" + w + " \x60file\x60]]", prose: [], code: ["\x60file\x60"] }),
	(w) => ({ text: "\x60\x60\x60\n[[" + w + "]]\n\x60\x60\x60", prose: [], code: ["\n[[" + w + "]]\n"] }),
	(w) => ({ text: "> \x60\x60\x60\n> [[" + w + "]]\n> \x60\x60\x60", prose: [], code: ["> [[" + w + "]]"] }),
	(w) => ({ text: "- item\n  \x60\x60\x60\n  [[" + w + "]]\n  \x60\x60\x60", prose: [], code: ["  [[" + w + "]]"] }),
	(w) => ({ text: "- a\n  - b\n    \x60\x60\x60\n    [[" + w + "]]\n    \x60\x60\x60", prose: [], code: ["    [[" + w + "]]"] }),
	(w) => ({ text: "          [[" + w + "]]", prose: [], code: ["          [[" + w + "]]"] }),
	(w) => ({ text: "\t\t\t[[" + w + "]]", prose: [], code: ["\t\t\t[[" + w + "]]"] }),
	(w) => ({ text: "\t\x60\x60\x60\n\t[[" + w + "]]\n\n\t\x60\x60\x60", prose: [], code: ["\t[[" + w + "]]\n\n"] }),
	(w) => ({ text: "<!-- [[" + w + "]] -->", prose: [], code: ["<!-- [[" + w + "]] -->"] }),
];
const INTROS = ["**Result:** x", "Intro sentence.", "## Status", "Intro sentence.\n- first [[Done]]", "Intro\n\t\x60\x60\x60\n\n\t\x60\x60\x60", ""];

function expectedCount(prose: string[]): string | undefined {
	const tally = new Map<string, number>();
	for (const p of prose) if (stateWords.some(([w]) => w === p)) tally.set(p, (tally.get(p) ?? 0) + 1);
	const total = [...tally.values()].reduce((a, b) => a + b, 0);
	const tone = (w: string) => STATE.indexOf(stateWords.find(([x]) => x === w)![1]);
	return total >= 5 && tally.size >= 2
		? [...tally.keys()].sort((a, b) => tone(a) - tone(b)).map((w) => "[[" + w + " " + tally.get(w) + "]]").join(" ")
		: undefined;
}

/** Item 1: the count line counts exactly the pills drawn; code stays as written; a second pass adds nothing. */
function checkCount(md: string, prose: string[], code: string[]) {
	const once = decorate(md, ansi, true);
	expect(drawnCount(once)).toBe(prose.length);
	for (const c of code) expect(once).toContain(c);
	expect(countLine(md)).toBe(expectedCount(prose));
	const out = decorate(md, ansi);
	expect(countLine(out)).toBeUndefined();
	expect(drawnCount(decorate(out, ansi))).toBe(drawnCount(out));
}

const plain = (t: string) => t;
const piTheme = { heading: plain, link: plain, linkUrl: plain, code: plain, codeBlock: plain, codeBlockBorder: plain, quote: plain, quoteBorder: plain, hr: plain, listBullet: plain, bold: plain, italic: plain, strikethrough: plain, underline: plain };
// The block structure pi's parser gives (pi-tui 1.5.2 lexes with marked 18.0.11, after tabs become three spaces).
const lexer = new Marked();
type Shape = string | { list: boolean; start: number | ""; items: Shape[][] } | { quote: Shape[] } | { code: string };
const shapeOf = (tokens: Token[]): Shape[] =>
	tokens
		.filter((t) => t.type !== "space")
		.map((t) =>
			t.type === "list" ? { list: t.ordered, start: t.start, items: t.items.map((i: Token & { tokens: Token[] }) => shapeOf(i.tokens)) }
			: t.type === "blockquote" ? { quote: shapeOf(t.tokens ?? []) }
			: t.type === "code" ? { code: t.text }
			: t.type,
		);
const lex = (md: string) => lexer.lexer(md.replace(/\t/g, "   "));
const render = (md: string) => new Markdown(md, 0, 0, piTheme).render(400).map((l) => l.trimEnd());

/** Item 2: the count line and its blank line come out whole; pi parses the rest as without them. */
function checkPlace(md: string) {
	const out = decorate(md, ansi).split("\n");
	const without = decorate(md, ansi, true).split("\n");
	if (out.length === without.length) {
		expect(out).toEqual(without);
		return;
	}
	let i = 0;
	while (out[i] === without[i]) i++;
	expect(out[i + 1]).toBe("");
	expect([...out.slice(0, i), ...out.slice(i + 2)]).toEqual(without);
	// pi's parser: the count line is a top-level paragraph of its own, and the other blocks keep their shape.
	const tokens = lex(out.join("\n"));
	const own = tokens.findIndex((t) => t.type === "paragraph" && t.raw.trim() === out[i]);
	expect(own).toBeGreaterThanOrEqual(0);
	expect(shapeOf(tokens.filter((_, k) => k !== own))).toEqual(shapeOf(lex(without.join("\n"))));
	// pi's renderer: the rendered count line and one blank row removed give the rendering without it.
	const rows = render(out.join("\n"));
	const countRows = render(out[i]);
	const plainRows = render(without.join("\n"));
	const at = rows.findIndex((_, r) => countRows.every((c, k) => rows[r + k] === c));
	expect(at).toBeGreaterThanOrEqual(0);
	const rest = [...rows.slice(0, at), ...rows.slice(at + countRows.length)];
	const blank = rest[at] === "" ? at : at - 1;
	expect(rest[blank]).toBe("");
	expect([...rest.slice(0, blank), ...rest.slice(blank + 1)]).toEqual(plainRows);
}

const replyOf = gs.record({
	intro: gs.sampledFrom(INTROS),
	blocks: gs.arrays(gs.record({ kind: gs.integers({ minValue: 0, maxValue: BLOCKS.length - 1 }), w: gs.sampledFrom(stateWords.map(([w]) => w)), v: gs.sampledFrom(stateWords.map(([w]) => w)) }), { maxSize: 10 }),
});
const build = (r: { intro: string; blocks: { kind: number; w: string; v: string }[] }) => {
	const blocks = r.blocks.map((b) => BLOCKS[b.kind](b.w, b.v));
	const md = [r.intro, ...blocks.map((b) => b.text)].filter((t) => t).join("\n\n");
	const prose = [...(r.intro.includes("[[Done]]") ? ["Done"] : []), ...blocks.flatMap((b) => b.prose)];
	return { md, prose, code: blocks.flatMap((b) => b.code) };
};

test("the count line counts exactly the pills drawn, never code or hidden comments, and only once", () =>
	hegel.test((tc) => {
		const { md, prose, code } = build(tc.draw(replyOf));
		checkCount(md, prose, code);
	}));

test("the count line sits at a top-level block boundary: removed, it leaves the reply as pi parses it without", () =>
	hegel.test((tc) => checkPlace(build(tc.draw(replyOf)).md)));

// The reviewer's inputs (review of f58b0b5), as fixed examples of the two properties.
const five = (pills: string[], line: (p: string, i: number) => string) => pills.map(line).join("\n");
const REVIEW = {
	codeInPill: five(["Done", "Done", "Done", "Done", "Failed"], (p) => "- [[" + p + " \x60file\x60]]"),
	quotedFence: "Intro\n\n> \x60\x60\x60\n" + five(["Done", "Done", "Done", "Done", "Needs you"], (p) => "> [[" + p + "]]") + "\n> \x60\x60\x60",
	deepListFence: "- a\n  - b\n    - c\n      \x60\x60\x60\n" + five(["Done", "Done", "Done", "Done", "Needs you"], (p) => "      [[" + p + "]]") + "\n      \x60\x60\x60",
	comment: "Intro\n\n<!-- [[Needs you]] -->\n\n" + five(["Done", "Done", "Done", "Failed"], (p) => "- [[" + p + "]]"),
	codeSeparated: "Intro\n\n[[Done]] \x60x\x60 [[Failed]]\n\n" + five(["Done", "Done", "Failed"], (p) => "- [[" + p + "]]"),
	orderedParen: five(["Done", "Failed", "Done", "Done", "Partial"], (p, i) => i + 1 + ") Build [[" + p + "]]").replaceAll("\n", "\n\n"),
	introLooseList: "Intro sentence.\n" + five(["Done", "Failed", "Done", "Done", "Partial"], (p) => "- [[" + p + "]] x").replaceAll("\n", "\n\n"),
	tabFence: "Intro\n\t\x60\x60\x60\n\n\t\x60\x60\x60\n" + five(["Done", "Failed", "Done", "Done", "Partial"], (p) => "- [[" + p + "]] x"),
};

const COUNT_CASES: [keyof typeof REVIEW, string[], string[]][] = [
	["codeInPill", [], ["\x60file\x60"]],
	["quotedFence", [], ["> [[Needs you]]"]],
	["deepListFence", [], ["      [[Needs you]]"]],
	["comment", ["Done", "Done", "Done", "Failed"], ["<!-- [[Needs you]] -->"]],
	["codeSeparated", ["Done", "Failed", "Done", "Done", "Failed"], ["\x60x\x60"]],
];
for (const [name, prose, code] of COUNT_CASES) {
	test("review input " + name + ": pills in code and hidden comments are neither drawn nor counted", () => checkCount(REVIEW[name], prose, code));
}

for (const name of ["orderedParen", "introLooseList", "tabFence"] as const) {
	test("review input " + name + ": the count line never splits a list or enters code", () => {
		expect(countLine(REVIEW[name])).toBeDefined();
		checkPlace(REVIEW[name]);
	});
}
