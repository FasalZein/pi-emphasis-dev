// Bold delimiters follow pi (differential). The reference is pi itself: pi-tui's Markdown with pi's configured
// parser (CJK emphasis included), hyperlinks on. For each reply, pi's rendering of the drawn reply is compared with
// pi's rendering of the written reply under three separate contracts:
//   preservation   the same visible text (exact whitespace; a pill reads as its word, a label icon is dropped),
//                  the same bold, italic and strikethrough per character, and the same OSC 8 link targets;
//   no false color the bold color only on characters pi draws bold;
//   required color every character of an unambiguous bold span (letters between spaces, top-level paragraph,
//                  one line or several) takes the bold color.
// The extension may leave any span as written (no color); only the third contract asks for color.
import { describe, expect, test } from "bun:test";
import { Markdown, setCapabilityOverrides } from "@earendil-works/pi-tui";
import { REVIEW, read } from "./rendering.ts";
import { load } from "./seam.ts";

setCapabilityOverrides({ hyperlinks: true });
const code = (name: string) => 16 + ([...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 100003, 7) % 200);
const fgAnsi = (name: string) => "\x1b[38;5;" + code(name) + "m";
const theme = {
	fg: (n: string, t: string) => fgAnsi(n) + t + "\x1b[39m",
	getFgAnsi: fgAnsi,
	getBgAnsi: (n: string) => "\x1b[48;5;" + code(n) + "m",
	getColorMode: () => "256color",
	colors: {},
};
const TONES = ["success", "error", "warning", "ask", "danger", "mode", "owner", "neutral"];
const ext = load(theme, { icons: "none", fill: Object.fromEntries(TONES.map((t) => [t, "text"])) });
const BOLD_FG = fgAnsi("mdLink");

const plain = (t: string) => t;
const sgr = (on: number, off: number) => (t: string) => "\x1b[" + on + "m" + t + "\x1b[" + off + "m";
// pi's styles as SGR: bold, italic and strikethrough are read back per character.
const piTheme = { heading: sgr(4, 24), link: plain, linkUrl: plain, code: plain, codeBlock: plain, codeBlockBorder: plain, quote: plain, quoteBorder: plain, hr: plain, listBullet: plain, bold: sgr(1, 22), italic: sgr(3, 23), strikethrough: sgr(9, 29), underline: plain };

const render = (md: string, width = 2000) => new Markdown(md, 0, 0, piTheme).render(width);
/** The facts of the written and the drawn reply that the contracts compare. */
function compare(md: string, width = 2000) {
	const raw = read(render(md, width), BOLD_FG);
	const drawn = read(render(ext.draw(md), width), BOLD_FG);
	return { raw, drawn };
}
const preserved = (md: string, width?: number) => {
	const { raw, drawn } = compare(md, width);
	return { text: drawn.text, style: drawn.style, targets: drawn.targets, expected: { text: raw.text, style: raw.style, targets: raw.targets } };
};

describe("review inputs", () => {
	for (const md of REVIEW) {
		test("preservation and no false color: " + JSON.stringify(md), () => {
			const p = preserved(md);
			expect({ text: p.text, style: p.style, targets: p.targets }).toEqual(p.expected);
			expect(compare(md).drawn.falseColor).toBe("");
		});
	}
	test("a narrow table that pi shows raw: preservation and no false color", () => {
		for (const md of ["| left | right |\n|---|---|\n| **one** | two |", "| left | right |\n|---|---|\n| **one | two** |"]) {
			const p = preserved(md, 8);
			expect({ text: p.text, style: p.style, targets: p.targets }).toEqual(p.expected);
			expect(compare(md, 8).drawn.falseColor).toBe("");
		}
	});
	test("no false action icon: __Do:** literal__ draws no icon", () => {
		expect(ext.draw("__Do:** literal__")).not.toMatch(/[\ue000-\uf8ff]/);
	});
});

// Generator: each dimension is drawn on its own; the realized combinations are counted.
function rng(seed: number) {
	return (k: number) => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return (((t ^ (t >>> 14)) >>> 0) % k);
	};
}
const D = {
	char: ["*", "_"],
	openLength: [1, 2, 2, 2, 3, 4],
	closeLength: [1, 2, 2, 2, 3, 4],
	left: ["", " ", "a", "(", "中", "「", "~", "~~", "`c`", "[[Done]]", "https://x.org/a", "→", "\\", "1", "\"", "$x$ "],
	inner: ["word", "two words", " spaced ", "中文", "「引」", "`code`", "[link](/u)", "[[Failed]]", "https://example.org", "a <!-- c --> b", "~~strike~~", "*em*", "_em_", "**in**", "a\nb", "Do:", "x@y.org", "<b>t</b>", "a ](x) b", "✓ ok"],
	right: ["", " ", "a", ")", "。", "文", "~", "_x_", "`c`", "[[Done]]", "](u)", "→", ".", "\\", "1"],
	container: ["", "", "- ", "> ", "1. ", "  ", "# ", "| ", "<div>"],
	after: ["", "\n", "\nnext line", "\n\nnew paragraph", "\n|---|---|\n| a | b |", " tail **x**", " $y"],
};
type Dim = keyof typeof D;
const DIMS = Object.keys(D) as Dim[];
function generate(rand: (k: number) => number, seen: Record<string, Set<string>>, combos: Set<string>): string {
	const pick: Record<string, string> = {};
	for (const d of DIMS) {
		const v = String(D[d][rand(D[d].length)]);
		pick[d] = v;
		(seen[d] ??= new Set()).add(v);
	}
	combos.add(DIMS.map((d) => pick[d]).join("\u0001"));
	const c = pick.char;
	const body = pick.container + pick.left + c.repeat(Number(pick.openLength)) + pick.inner + c.repeat(Number(pick.closeLength)) + pick.right + pick.after;
	return rand(3) === 0 ? "Intro " + body : body;
}

const REPLIES = 6000;
describe("generated replies", () => {
	test("preservation and no false color", () => {
		const rand = rng(20261119);
		const seen: Record<string, Set<string>> = {};
		const combos = new Set<string>();
		const fails: string[] = [];
		let colored = 0;
		for (let r = 0; r < REPLIES; r++) {
			let md = generate(rand, seen, combos);
			if (rand(2)) md += "\n" + generate(rand, seen, combos);
			// Narrow: a table that pi shows raw. (Elsewhere a label icon takes width and may wrap the line elsewhere.)
			const width = md.includes("|") && rand(3) === 0 ? 8 : 2000;
			const { raw, drawn } = compare(md, width);
			if (drawn.text.length && ext.draw(md).includes(BOLD_FG)) colored++;
			if (drawn.text !== raw.text || drawn.style !== raw.style || drawn.targets.join() !== raw.targets.join() || drawn.falseColor !== "")
				fails.push(JSON.stringify(md) + " width " + width + "\n  pi:    " + JSON.stringify(raw.text) + " " + raw.style + " " + JSON.stringify(raw.targets) + "\n  drawn: " + JSON.stringify(drawn.text) + " " + drawn.style + " " + JSON.stringify(drawn.targets) + " false color " + JSON.stringify(drawn.falseColor));
		}
		const values = Object.fromEntries(DIMS.map((d) => [d, seen[d].size + "/" + new Set(D[d].map(String)).size]));
		console.log("replies:", REPLIES, "; realized combinations:", combos.size, "; values per dimension:", JSON.stringify(values), "; with bold color:", colored, "; failures:", fails.length);
		for (const d of DIMS) expect(seen[d].size).toBe(new Set(D[d].map(String)).size);
		expect(fails.slice(0, 4)).toEqual([]);
	});
	test("required color on unambiguous spans", () => {
		const rand = rng(7);
		const WORDS = ["alpha", "beta", "gamma", "delta", "omega"];
		const word = () => WORDS[rand(WORDS.length)];
		const fails: string[] = [];
		let spans = 0;
		for (let r = 0; r < 1500; r++) {
			const parts: string[] = [];
			for (let n = 1 + rand(5); n > 0; n--) {
				const inner = Array.from({ length: 1 + rand(3) }, word).join(rand(4) === 0 ? "\n" : " ");
				parts.push(rand(2) ? "**" + inner + "**" : word());
				if (parts[parts.length - 1].startsWith("**")) spans++;
			}
			const md = parts.join(rand(5) === 0 ? "\n" : " ");
			const { raw, drawn } = compare(md);
			if (drawn.uncolored !== "" || drawn.text !== raw.text) fails.push(JSON.stringify(md) + " uncolored " + JSON.stringify(drawn.uncolored));
		}
		console.log("unambiguous replies: 1500 ; bold spans:", spans, "; failures:", fails.length);
		expect(fails.slice(0, 4)).toEqual([]);
	});
});
