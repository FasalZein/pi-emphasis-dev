// The layout while a reply streams (owner decision 2026-11-18): the count line goes after the last block, an
// unfinished tail (a pill, a bold label, a heading line) waits until it completes, and an action or label icon
// is joined to its word, so it never ends a row alone. Rendering goes through pi-tui's Markdown, as pi draws it.
import { describe, expect, test } from "bun:test";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { Markdown, rgbColor } from "@earendil-works/pi-tui";
import { load, type Theme } from "./seam.ts";

const RGB: Record<string, [number, number, number]> = {
	success: [195, 232, 141], error: [255, 117, 127], warning: [255, 199, 119], accent: [130, 170, 255], customMessageLabel: [192, 153, 255],
	text: [200, 211, 245], mdLink: [130, 170, 255], dim: [84, 92, 126], toolPendingBg: [26, 27, 38], selectedBg: [47, 51, 77],
	toolSuccessBg: [30, 43, 40], toolErrorBg: [44, 32, 48], searchMatchBg: [47, 51, 77],
};
const fgEsc = (name: string) => "\x1b[38;2;" + RGB[name].join(";") + "m";
const truecolor: Theme = {
	fg: (name: never, text: string) => fgEsc(name) + text + "\x1b[39m",
	getFgAnsi: (name: never) => fgEsc(name),
	getBgAnsi: (name: never) => "\x1b[48;2;" + RGB[name].join(";") + "m",
	getColorMode: () => "truecolor",
	colors: Object.fromEntries(Object.entries(RGB).map(([name, [r, g, b]]) => [name, rgbColor(r, g, b)])),
};
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
type Kind = "word" | "pill" | "bold" | "code";
const token = gs.oneOf(
	gs.sampledFrom(["alpha", "beta", "x1", "go!", "a:b", "(c)"]).map((t) => ({ kind: "word" as Kind, text: t })),
	gs.sampledFrom(["Done", "Implement", "Shared", "Owned", "Preview", "Done 3/4"]).map((t) => ({ kind: "pill" as Kind, text: "[[" + t + "]]" })),
	gs.sampledFrom(["Fix:", "Check:", "Result:", "Cause", "Left:"]).map((t) => ({ kind: "bold" as Kind, text: "**" + t + "**" })),
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
			if (t.kind === "pill" || t.kind === "bold") spans.push({ start: text.length, end: text.length + t.text.length, line: false });
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

describe("an icon never ends a row alone", () => {
	test("an action or label icon wraps with its word", () =>
		hegel.test((tc) => {
			const words = tc.draw(gs.arrays(gs.sampledFrom(["a", "bb", "ccc", "dddd", "eeeee"]), { minSize: 0, maxSize: 12 }));
			const lead = tc.draw(gs.sampledFrom(["Check:", "Do:", "Next:", "Left:", "Guard:", "Undo:", "See:", "Unblock:", "Run:"]));
			const width = tc.draw(gs.integers({ minValue: 12, maxValue: 40 }));
			const first = tc.draw(gs.booleans());
			const md = first ? "**" + lead + "** " + words.join(" ") + " step" : (words.join(" ") + " **" + lead + "** step").trim();
			for (const row of rows(load(truecolor).draw(md), width)) expect(row).not.toMatch(/[\ue000-\uf8ff]$/u);
		}));
});
