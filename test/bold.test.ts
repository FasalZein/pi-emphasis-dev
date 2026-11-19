// Bold delimiters follow pi (differential): for generated replies, pi's rendering of the drawn reply shows the
// same visible text and the same bold spans as pi's rendering of the written reply, and the bold color covers
// only text pi draws bold. The reference is pi itself: pi-tui's Markdown (pi's configured parser, CJK emphasis
// included), as test/oracle.ts uses it. Pills are drawn text-only without icons here, so a drawn pill shows its
// word; the comparison reads a written pill "[[Word]]" as that word.
import { describe, expect, test } from "bun:test";
import { Markdown } from "@earendil-works/pi-tui";
import { load } from "./seam.ts";

const code = (name: string) => 16 + ([...name].reduce((h, c) => h * 31 + c.charCodeAt(0), 7) % 200);
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
const BOLD_COLOR = fgAnsi("mdLink");

const plain = (t: string) => t;
const span = (name: string) => (t: string) => "{" + name + "}" + t + "{/" + name + "}";
const styled = { heading: span("H"), link: plain, linkUrl: plain, code: plain, codeBlock: plain, codeBlockBorder: plain, quote: plain, quoteBorder: plain, hr: plain, listBullet: plain, bold: span("B"), italic: span("I"), strikethrough: span("S"), underline: plain };
const CONTROL = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[ -\/]*[@-~]/g;
const ON = "\u0003";
const OFF = "\u0004";
/** pi's rendering with style spans marked, the bold color as ON/OFF and every other control sequence removed. */
function render(md: string): string {
	return new Markdown(md, 0, 0, styled)
		.render(2000)
		.map((l) => l.split(BOLD_COLOR).join(ON).replace(/\x1b\[(?:39|0)m/g, OFF).replace(/\x1b\[38;[0-9;]*m/g, OFF).replace(CONTROL, "").trimEnd())
		.join("\n");
}
/** Visible text with style spans; written pills read as their word, label icons dropped, space runs as one space. */
const shown = (r: string) => r.replace(/[\u0003\u0004]/g, "").replace(/[\ue000-\uf8ff\u{f0000}-\u{ffffd}]\u2002/gu, "").replace(/\[\[([A-Za-z]+)\]\]/g, "$1").replace(/[ \u00a0]+/g, " ");
/** Characters drawn in the bold color outside every bold span. */
function colorOutsideBold(r: string): string {
	let on = false;
	let depth = 0;
	let out = "";
	for (let i = 0; i < r.length; i++) {
		if (r[i] === ON) on = true;
		else if (r[i] === OFF) on = false;
		else if (r.startsWith("{B}", i)) (depth++, (i += 2));
		else if (r.startsWith("{/B}", i)) (depth--, (i += 3));
		else if (r[i] === "{" && /^\{\/?[HIS]\}/.test(r.slice(i))) i = r.indexOf("}", i);
		else if (on && depth === 0 && r[i].trim()) out += r[i];
	}
	return out;
}

// Fragments per class. Each reply is lines of fragments; the class counts say what the replies cover.
const CLASSES: Record<string, string[]> = {
	operator: ["2 ** 3", "2 ** 3 ** 4", "a __ b __ c", "x ** y", "n __ m"],
	run3: ["***both***", "___both___", "****four****", "***a** b*", "**a***", "___x__"],
	intraword: ["snake_case_name", "a*b*c", "foo__bar__baz", "x**y**z", "a_b__c", "file__init__.py"],
	nested: ["**a **b** c**", "**a****b**", "**a** **b**", "**a**b**c**", "__a **b** c__", "**x __y__ z**", "*a **b** c*"],
	multiline: ["**first\nsecond** after", "**open\nmiddle\nclose** end", "text **a\nb** c **d**", "x**\n**y", "**end.\nnext** x", "**a \\\nb** c", "**a\n*b* c**", "**a  \nb** c", "**中\n文** x", "**a_\n_b** c", "**a\n__b__ c**"],
	pill: ["**Result:** [[Done]] text", "x**[[Done]]** y", "**[[Failed]]**", "[[Done]]**x**", "**Build** [[Passed]] text", "a **[[Done]]** b", "**x [[Done]]** y", "**x**[[Done]]"],
	label: ["**Do:** run it", "**Next:** go", "**Check:** x **y**", "**Result:**", "**Finding** text", "- **Risk:** low"],
	glyph: ["✓**ok**", "**✓ ok**", "**ok** → **go**", "**a→b**", "✗ **no**"],
	cjk: ["中文**加粗**文字", "**「引用」**です", "日本**語**", "**한국어**입니다", "これは**太字**です。", "**中**，文"],
	escape: ["\\**not bold**", "\\*\\*x\\*\\*", "**a\\*b**", "\\\\**bold**", "x \\** a **b**", "**a\\**"],
	plain: ["plain words", "**bold**", "__under__", "more **text** here", "(**paren**)", "**\"quoted\"**", "end."],
};
const NAMES = Object.keys(CLASSES);
let seed = 20261119;
const rand = (k: number) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % k);
const PREFIX = ["", "", "", "- ", "> ", "1. "];
function reply(classes: Set<string>): string {
	const lines: string[] = [];
	for (let n = 1 + rand(4); n > 0; n--) {
		const parts: string[] = [];
		for (let f = 1 + rand(3); f > 0; f--) {
			const name = NAMES[rand(NAMES.length)];
			classes.add(name);
			const list = CLASSES[name];
			parts.push(list[rand(list.length)]);
		}
		lines.push(PREFIX[rand(PREFIX.length)] + parts.join(rand(4) === 0 ? "" : " "));
	}
	return lines.map((l, i) => (i === 0 ? l : (rand(2) ? "\n" : "\n\n") + l)).join("");
}

const REPLIES = 4000;
describe("bold delimiters follow pi", () => {
	test("examples from the review: pi's visible text and bold spans stay as written", () => {
		for (const md of ["The powers are 2 ** 3 ** 4.", "2 ** 3 and **bold** here", "___important___", "a __ b __ c", "**first\nsecond** after", "x **[[Done]]** y **z", "a ** b [[Done]] c **d**"]) {
			const raw = render(md);
			const out = render(ext.draw(md));
			expect(shown(out)).toBe(shown(raw));
			expect(colorOutsideBold(out)).toBe("");
		}
	});
	test("generated replies: same visible text and bold spans, bold color only inside bold", () => {
		const counts = Object.fromEntries(NAMES.map((n) => [n, 0]));
		const failures: string[] = [];
		let colored = 0;
		for (let r = 0; r < REPLIES; r++) {
			const classes = new Set<string>();
			const md = reply(classes);
			for (const c of classes) counts[c]++;
			const raw = render(md);
			const out = render(ext.draw(md));
			if (out.includes(ON)) colored++;
			if (shown(out) !== shown(raw) || colorOutsideBold(out) !== "") failures.push(JSON.stringify(md) + "\n  pi:    " + JSON.stringify(shown(raw)) + "\n  drawn: " + JSON.stringify(shown(out)) + "\n  color outside bold: " + JSON.stringify(colorOutsideBold(out)));
		}
		console.log("replies:", REPLIES, "; with bold color:", colored, "; per class:", JSON.stringify(counts), "; failures:", failures.length);
		for (const n of NAMES) expect(counts[n]).toBeGreaterThan(0);
		expect(colored).toBeGreaterThan(REPLIES / 4);
		expect(failures.slice(0, 5)).toEqual([]);
	});
});
