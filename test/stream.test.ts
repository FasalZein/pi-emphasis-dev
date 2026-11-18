// The layout while a reply streams (owner decision 2026-11-18): the count line goes after the last block, an
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

// Review round 1 (a220492). Each case is rendered through pi-tui, streamed after a warm cache and on a fresh instance.
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

describe("review round 1", () => {
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
