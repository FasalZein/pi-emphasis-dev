// The layout while a reply streams: the count line goes after the last block, an
// unfinished tail (a pill, a bold label, a heading line) waits until it completes, and an action or label icon
// is joined to its word, so it never ends a row alone. Rendering goes through pi-tui's Markdown, as pi draws it.
import { describe, expect, test } from "bun:test";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { Markdown } from "@earendil-works/pi-tui";
import { load } from "./seam.ts";
import { truecolor } from "./truecolor.ts";

const plain = (t: string) => t;
const piTheme = { heading: plain, link: plain, linkUrl: plain, code: plain, codeBlock: plain, codeBlockBorder: plain, quote: plain, quoteBorder: plain, hr: plain, listBullet: plain, bold: plain, italic: plain, strikethrough: plain, underline: plain };
const ESCAPE = /\x1b\[[0-9;]*m/g;
/** pi's rows for a drawn reply, escapes removed and trailing spaces cut. */
const rows = (drawn: string, width: number) => new Markdown(drawn, 0, 0, piTheme).render(width).map((r) => r.replace(ESCAPE, "").trimEnd());

describe("count line at the end", () => {
	const REPLY = [
		"**Result:** the release is close. One step needs you.",
		"",
		"- **Build** [[Passed]] 212 of 212.",
		"- **Changelog** [[Done]] written.",
		"- **Docs** [[In progress]] 3 of 5.",
		"- **Key** [[Needs you]] unlock it. **Do:** run the unlock script.",
		"- **Version** [[Decision]] 2.0 or 1.9?",
		"",
		"The tag waits for the key.",
	].join("\n");
	for (const width of [40, 80, 120]) {
		test("at width " + width + ", completion keeps every row of the last streamed frame and adds the count line under them", () => {
			const ext = load(truecolor);
			const streamed = rows(ext.draw(REPLY, true), width);
			const finished = rows(ext.draw(REPLY), width);
			expect(finished.slice(0, streamed.length)).toEqual(streamed);
			const added = finished.slice(streamed.length);
			expect(added[0]).toBe("");
			expect(added.join(" ")).toContain("Needs\u00a0you\u00a01");
		});
	}
});

// A reply as lines of tokens, so the test knows where each pill, bold label and heading starts and ends.
type Kind = "word" | "pill" | "bold" | "code" | "operator";
const token = gs.oneOf(
	// Currency and escapes before a tail do not stop it from waiting.
	gs.sampledFrom(["alpha", "beta", "x1", "go!", "a:b", "(c)", "$5", "$12.50", "\\*", "\\_x"]).map((t) => ({ kind: "word" as Kind, text: t })),
	gs.sampledFrom(["Done", "Implement", "Shared", "Owned", "Preview", "Done 3/4", "Done **detail", "a".repeat(32)]).map((t) => ({ kind: "pill" as Kind, text: "[[" + t + "]]" })),
	gs.sampledFrom(["**Fix:**", "**Check:**", "**Result:**", "**Cause**", "**Left:**", "__Fix:__", "**" + "b".repeat(32) + "**"]).map((t) => ({ kind: "bold" as Kind, text: t })),
	// An operator between spaces opens no bold: it waits only while it could still be an opening marker.
	gs.just({ kind: "operator" as Kind, text: "** 3" }),
	gs.sampledFrom(["`[[Done]]`", "`**x`", "`a b`"]).map((t) => ({ kind: "code" as Kind, text: t })),
);
const line = gs.oneOf(
	gs.record({ heading: gs.just(false), lead: gs.sampledFrom(["", "- ", "1. "]), tokens: gs.arrays(token, { minSize: 1, maxSize: 6 }) }),
	gs.record({ heading: gs.just(true), lead: gs.sampledFrom(["## ", "### "]), tokens: gs.arrays(token.filter((t) => t.kind === "word"), { minSize: 1, maxSize: 3 }) }),
);
const reply = gs.arrays(gs.record({ line, gap: gs.sampledFrom(["\n", "\n\n"]) }), { minSize: 1, maxSize: 5 });

/** The reply's text and the spans a streaming frame may hold back: [start, end, whole line]. */
function build(lines: { line: { heading: boolean; lead: string; tokens: { kind: Kind; text: string }[] }; gap: string }[]) {
	let text = "";
	const spans: { start: number; end: number; line: boolean }[] = [];
	lines.forEach(({ line, gap }, i) => {
		if (i > 0) text += gap;
		const lineStart = text.length;
		text += line.lead;
		line.tokens.forEach((t, k) => {
			if (k > 0) text += " ";
			if (t.kind === "pill" || t.kind === "bold" || t.kind === "operator") spans.push({ start: text.length, end: text.length + t.text.length, line: false });
			text += t.text;
		});
		if (line.heading) spans.push({ start: lineStart, end: text.length, line: true });
	});
	return { text, spans };
}

describe("an unfinished tail waits while streaming", () => {
	test("every streamed prefix draws as the finished drawing of the prefix without its unfinished pill, bold label or heading line", () =>
		hegel.test((tc) => {
			const { text, spans } = build(tc.draw(reply));
			const ext = load(truecolor);
			for (let n = 1; n <= text.length; n++) {
				// pi trims the text it hands the transformer.
				const prefix = text.slice(0, n).trim();
				const end = text.slice(0, n).trimEnd().length;
				// A pill or bold label is unfinished until its last character; a heading line until a line follows it.
				const open = spans.find((s) => s.start < end && (s.line ? end <= s.end : end < s.end));
				// Held: the text before the tail, without its trailing spaces, and without the line break before a line left empty.
				const shown = open ? text.slice(0, open.start).replace(/[ \t]+$/, "").replace(/\n$/, "").trimStart() : prefix;
				expect(ext.draw(prefix, true)).toBe(load(truecolor).draw(shown));
			}
		}));

	test("literal text at the tail is never held back", () => {
		const ext = load(truecolor);
		for (const md of ["a `[[Do", "a `**Fix", "x $[[a", "```\n[[Do", "    **Fix", "a [[Done]] `b` [[Do `c`", "\\[[Do", "## `code`"]) expect(ext.draw(md, true)).toBe(load(truecolor).draw(md));
	});

	test("the finished reply shows the tail as written", () => {
		const ext = load(truecolor);
		expect(ext.draw("x [[Do").replace(ESCAPE, "")).toBe("x [[Do");
		expect(ext.draw("x **Fix").replace(ESCAPE, "")).toBe("x **Fix");
	});
});

// The icons of the action lead-ins and of one lead label, from the design tables (README "Action lead-ins").
const ICONS: Record<string, string> = {
	"Check:": "\uf046", "Do:": "\uf0a4", "Next:": "\uf061", "Unblock:": "\uf09c", "Left:": "\uf141", "Run:": "\uf04b", "Guard:": "\uf132", "Undo:": "\uf0e2", "See:": "\uf08e", "Cause:": "\uf0e7",
};
describe("an icon never ends a row alone", () => {
	test("an action or label icon and its word share a row", () =>
		hegel.test((tc) => {
			const words = tc.draw(gs.arrays(gs.sampledFrom(["a", "bb", "ccc", "dddd", "eeeee"]), { minSize: 0, maxSize: 12 }));
			const lead = tc.draw(gs.sampledFrom(Object.keys(ICONS)));
			const width = tc.draw(gs.integers({ minValue: 12, maxValue: 40 }));
			// Cause: takes its icon only as a lead label, at the line start.
			const first = lead === "Cause:" || tc.draw(gs.booleans());
			const md = first ? "**" + lead + "** " + words.join(" ") + " step" : (words.join(" ") + " **" + lead + "** step").trim();
			const shown = rows(load(truecolor).draw(md), width);
			expect(shown.some((row) => row.includes(ICONS[lead] + "\u2002" + lead))).toBe(true);
			for (const row of shown) expect(row).not.toMatch(/[\ue000-\uf8ff]$/u);
		}));
});

// Each case is rendered through pi-tui, streamed after a warm cache and on a fresh instance.
// pi-tui's renderBlock is private: it is reached through an untyped subclass.
const PiMarkdown = Markdown as unknown as new (...args: unknown[]) => { render(width: number): string[]; renderBlock(...args: unknown[]): unknown };
class Track extends PiMarkdown {
	owners: string[] = [];
	renderBlock(block: unknown, token: { type: string; raw: string }, ...rest: unknown[]) {
		if (token.raw.includes("Failed\u00a02")) this.owners.push(token.type);
		return super.renderBlock(block, token, ...rest);
	}
}
/** The pi token types that hold the drawn count line (its "Failed 2" pill). */
function countOwners(drawn: string): string[] {
	const md = new Track(drawn, 0, 0, piTheme);
	md.render(120);
	return md.owners;
}
const FIVE = "Work [[Done]] [[Done]] [[Done]] [[Failed]] [[Failed]].";
/** A streamed frame drawn after a warm cache equals the fresh drawing; returns its rows. */
function streamed(md: string, width = 120): string[] {
	const warm = load(truecolor);
	warm.draw("para\n\nold", true);
	const out = warm.draw(md, true);
	expect(out).toBe(load(truecolor).draw(md, true));
	return rows(out, width);
}
const finished = (md: string, width = 120) => rows(load(truecolor).draw(md), width);

describe("count line and held tails", () => {
	for (const tail of ["<pre>\nlast", "<?pi\nlast", "<!DOCTYPE x\nlast", "<![CDATA[\nlast", "$$\nx^2", "\\[\nx^2", "```js\nlast", "<!--\nlast", "<pre>\n\nlast", "- item\n\n  ```\n  code"]) {
		test("a reply that ends in an open block " + JSON.stringify(tail) + " keeps the count line out of it, as its own paragraph", () => {
			expect(countOwners(load(truecolor).draw(FIVE + "\n\n" + tail))).toEqual(["paragraph"]);
		});
	}
	for (const tail of ["- last", "> last", "<pre>x</pre>\n\nlast", "$$\nx^2\n$$\n\nlast", "<div>\nlast"]) {
		test("a reply that ends in a closed block " + JSON.stringify(tail) + " takes the count line at the end", () => {
			const drawn = load(truecolor).draw(FIVE + "\n\n" + tail);
			expect(countOwners(drawn)).toEqual(["paragraph"]);
			expect(drawn.split("\n").at(-1)).toContain("Failed\u00a02");
		});
	}
	for (const md of ["<pre>\n[[Do", "$$\nx^2 [[Do", "<?pi\n**Fix", "<div>\n[[Do", "x $a [[Do", "a \\(x [[Do"]) {
		test("text in an open HTML or math block, or after an open math mark, is never held: " + JSON.stringify(md), () => expect(streamed(md)).toEqual(finished(md)));
	}
	for (const md of ["2 ** 3 = 8", "a [[Done **detail]] ok", "**first\nlast**", "a **b** c", "x**y"]) {
		test("a star run that opens no bold shows while streaming: " + JSON.stringify(md), () => expect(streamed(md)).toEqual(finished(md)));
	}
	for (const [md, shown] of [["Cost $5. [[Do", "Cost $5."], ["x \\* ok [[Do", "x \\* ok"], ["x [[" + "a".repeat(32) + "]", "x"], ["x __Fix", "x"], ["a `code` [[Do", "a `code`"], ["## C# costs $5", ""], ["x **" + "b".repeat(32) + "*", "x"]]) {
		test("an unfinished tail waits whatever comes before it on the line: " + JSON.stringify(md), () => expect(streamed(md)).toEqual(finished(shown)));
	}
});

// The expected outcome comes from pi's own reading of the source text: the
// pi-tui Markdown token that holds a line, never the extension's drawing of a second candidate.
class Tokens extends PiMarkdown {
	tokens: { type: string; raw: string }[] = [];
	renderBlock(block: unknown, token: { type: string; raw: string }, ...rest: unknown[]) {
		if (token.type !== "space") this.tokens.push({ type: token.type, raw: token.raw });
		return super.renderBlock(block, token, ...rest);
	}
}
/** pi's top-level tokens of a text, without the space between blocks. */
function tokensOf(md: string): { type: string; raw: string }[] {
	const t = new Tokens(md, 0, 0, piTheme);
	t.render(120);
	return t.tokens;
}
// Block shapes: an opening line, body lines (prose, pills, and the opening or end line of another block), an
// optional end line, then a prose tail. HTML types 1, 3-5 end at their marker; type 6 (div) at a blank line.
const BLOCKS: Record<string, [string, string]> = {
	"html 1": ["<pre>", "</pre>"],
	"html 3": ["<?pi", "?>"],
	"html 4": ["<!DOCTYPE x", ">"],
	"html 5": ["<![CDATA[", "]]>"],
	div: ["<div>", "</div>"],
	"$$": ["$$", "$$"],
	"\\[": ["\\[", "\\]"],
};
const KINDS = Object.keys(BLOCKS);
const TAILS = ["[[Do", "alpha [[Do", "**Fix", "alpha **Fix", "alpha", "[[Done]] ok"];
const shape = gs.record({
	kind: gs.sampledFrom(KINDS),
	// Another block's opening line, or an end line that does not start with "<" (a lone "</pre>" after a closed
	// block is a paragraph for pi that the reader shows as written).
	body: gs.arrays(gs.oneOf(gs.sampledFrom(["text", "[[Done]] x", "**Fix:** y", ">"]), gs.sampledFrom(KINDS.flatMap((k) => BLOCKS[k]).filter((l, i) => i % 2 === 0 || l[0] !== "<"))), { maxSize: 2 }),
	closed: gs.booleans(),
	gap: gs.sampledFrom(["\n", "\n\n"]),
	tail: gs.sampledFrom(TAILS),
	five: gs.booleans(),
});
type Shape = { kind: string; body: string[]; closed: boolean; gap: string; tail: string; five: boolean };
function compose(s: Shape) {
	const [open, close] = BLOCKS[s.kind];
	const block = [open, ...s.body, ...(s.closed ? [close] : [])].join("\n");
	return (s.five ? FIVE + "\n\n" : "") + block + s.gap + s.tail;
}
/** The unfinished pill or bold label at the end of a tail, -1 when none. */
const tailOpen = (tail: string) => Math.max(tail.endsWith("[[Do") ? tail.length - 4 : -1, tail.endsWith("**Fix") ? tail.length - 5 : -1);
/** The drawn count line of FIVE on its own, where nothing can hold it. */
const COUNT = load(truecolor).draw(FIVE).split("\n").at(-1)!;

/** The streamed check for one shape: the tail shows in full in a block's literal text, and waits where pi starts a paragraph. */
function checkStreamed(s: Shape) {
	const md = compose(s);
	const owner = tokensOf(md).at(-1)!;
	const out = load(truecolor).draw(md, true);
	const cut = tailOpen(s.tail);
	if (owner.type === "paragraph" && owner.raw.trimEnd().endsWith(s.tail) && cut >= 0) {
		// Held: the text before the tail, without trailing spaces, and the line break before a line left empty.
		const shown = md.slice(0, md.length - s.tail.length + cut).replace(/[ \t]+$/, "").replace(/\n$/, "");
		expect(out).toBe(load(truecolor).draw(shown, true));
		expect(out.replace(ESCAPE, "").endsWith(s.tail.slice(cut))).toBe(false);
	} else if (owner.type !== "paragraph") {
		// Text of a block: nothing waits, and the tail's last word shows as written.
		expect(out.replace(ESCAPE, "").endsWith(s.tail.slice(s.tail.lastIndexOf(" ") + 1))).toBe(true);
	}
}

describe("block transitions", () => {
	test("streamed: the tail shows in full where pi reads it as a block's literal text, and waits where pi starts a paragraph", () =>
		hegel.test((tc) => checkStreamed(tc.draw(shape)), { testCases: 400 }));

	test("finished: the count line is its own paragraph after the body, at the end, or before a block pi keeps open to the end", () =>
		hegel.test((tc) => {
			const s: Shape = { ...tc.draw(shape), five: true };
			const md = compose(s);
			// The reply ends in a block pi keeps open when the count line, put after it, joins it.
			const open = !tokensOf(md + "\n\n" + COUNT).at(-1)!.raw.startsWith(COUNT);
			const tokens = tokensOf(load(truecolor).draw(md));
			const body = tokens.findIndex((t) => t.raw.includes("Work"));
			const count = tokens.findIndex((t) => t.raw.includes("Failed\u00a02"));
			expect(body).toBe(0);
			expect(tokens[count]?.type).toBe("paragraph");
			expect(tokens[count].raw).not.toContain("Work");
			expect(count).toBe(open ? 1 : tokens.length - 1);
		}, { testCases: 400 }));

	test("streamed: every block kind, with and without the count-line text before it, passes the check for every tail", () => {
		for (const kind of KINDS) for (const five of [false, true]) for (const closed of [false, true]) for (const tail of TAILS)
			checkStreamed({ kind, body: [], closed, gap: "\n\n", tail, five });
	});

	for (const md of ["<pre>\n<?pi\n?>\n\n[[Do", "<pre>\n<!DOCTYPE\n>\n\n[[Do"]) {
		test("an opener inside an open HTML block does not end it: " + JSON.stringify(md), () => expect(load(truecolor).draw(md, true)).toContain("[[Do"));
	}
	// Rare compositions the generator seldom reaches (reader states after an HTML block's end line, a lone ">" in one).
	for (const [md, type] of [["<pre>\n</pre>\n[[Do", "paragraph"], ["<?pi\n>\n$$\n?>\n[[Do", "paragraph"], ["<div>\n>\n[[Do", "html"], ["<pre>\n>\n$$\n[[Do", "html"]]) {
		test("pi reads the tail of " + JSON.stringify(md) + " as " + type + ": it " + (type === "paragraph" ? "waits" : "shows"), () => {
			expect(tokensOf(md).at(-1)!.type).toBe(type);
			const out = load(truecolor).draw(md, true);
			if (type === "paragraph") expect(out).toBe(load(truecolor).draw(md.slice(0, -"\n[[Do".length), true));
			else expect(out.replace(ESCAPE, "").endsWith("[[Do")).toBe(true);
		});
	}
	test("the count line stays out of an HTML block that holds another opener", () => {
		const tokens = tokensOf(load(truecolor).draw(FIVE + "\n\n<pre>\n<?pi\n?>\n\nlast"));
		expect(tokens.map((t) => t.type)).toEqual(["paragraph", "paragraph", "html"]);
		expect(tokens[1].raw).toContain("Failed\u00a02");
	});
});

// Code, HTML and math whose lines hold pill and bold syntax. Streamed, every prefix shows the source text:
// code and a comment exactly as pi shows the raw source (the extension leaves them as written), closed math as
// a whole, and an open HTML block or pending math, which the extension draws in its finished look too, with
// every source character visible.
const CODE = ["```\n[[Done]] **Fix** [[Do", "x\n\n    [[Done]] **Fix**", "<!--\n[[Done]] **Fix** [[Do"];
const MATH = ["$$\n[[Done]] **Fix** x\n$$", "\\[\n[[Done]] **Fix** y\n\\]"];
const SHOWN = ["<pre>\n[[Do **Fix", "<?pi\n[[Do", "<!DOCTYPE x\n**Fix", "<![CDATA[\n[[Do", "<div>\n**Fix [[Do", "$$\nx [[Do", "\\[\n**Fix"];
describe("source-anchored literal visibility", () => {
	test("a streamed literal shows as pi shows the raw source, or with every source character, never by the drawing of a second candidate", () =>
		hegel.test((tc) => {
			const group = tc.draw(gs.sampledFrom(["code", "math", "shown"]));
			const literal = tc.draw(gs.sampledFrom(group === "code" ? CODE : group === "math" ? MATH : SHOWN));
			const n = group === "math" ? literal.length : tc.draw(gs.integers({ minValue: 1, maxValue: literal.length }));
			const width = tc.draw(gs.integers({ minValue: 20, maxValue: 80 }));
			// pi trims the text it hands the transformer.
			const md = literal.slice(0, n).trim();
			const out = load(truecolor).draw(md, true);
			if (group === "shown") expect(out.replace(ESCAPE, "")).toContain(md);
			else {
				expect(out).toBe(md);
				expect(rows(out, width)).toEqual(rows(md, width));
			}
		}));
});

describe("label length boundary", () => {
	test("an unfinished pill or bold label of up to 32 characters waits; at 33 or more the source label shows", () =>
		hegel.test((tc) => {
			const length = tc.draw(gs.integers({ minValue: 30, maxValue: 36 }));
			const label = tc.draw(gs.sampledFrom(["a", "b", "Z"])).repeat(length);
			const md = tc.draw(gs.sampledFrom(["x [[", "x **"])) + label + tc.draw(gs.sampledFrom(["", "]", "*"]));
			// "]" after "**" or "*" after "[[" is part of the label.
			const out = load(truecolor).draw(md, true).replace(ESCAPE, "");
			const chars = md.length - 4 - (md.endsWith("]") && md.startsWith("x [[") || md.endsWith("*") && md.startsWith("x **") ? 1 : 0);
			if (chars <= 32) expect(out).toBe("x");
			else expect(out).toContain(label);
		}));
});

