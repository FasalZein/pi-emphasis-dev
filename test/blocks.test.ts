// Fences, comments and math follow pi (reader slice 2). Reference: pi's rendering of the raw reply (pi-tui's
// Markdown through test/oracle.ts and test/links-oracle.ts). Five classes: a fence opener inside an HTML block,
// comment boundaries, marked's fence grammar, list-fence termination, display math after indented code.
// (1) Named review inputs: each pill is drawn exactly where pi shows it as prose, and counted exactly then.
// (2) A generated differential over the classes, joined in one reply: no pill is drawn or counted where pi shows
// code, math or nothing; the printed text equals pi's (drawn pills written back); a pill pi shows that is not
// drawn is a counted over-protection, bounded so that a transform that draws nothing fails.
// (3) Replaced-suffix sequences on one registration equal a fresh drawing.
import { expect, test } from "bun:test";
import { drawnCount, drawnIds, expectPillsAsPi, markedIds } from "./links-oracle.ts";
import { piRender, piShown } from "./oracle.ts";
import { countLineOf, load, type Loaded } from "./seam.ts";
import { truecolor } from "./truecolor.ts";

const ext = load(truecolor);
const FOUR = "Text [[Done]] [[Failed]] [[Passed]] [[Blocked]].\n\n";
const id = (md: string) => md.replace("[[Done]]", "[[Done p0q]]");

// pi shows the pill as code, math or nothing: not drawn, not counted (expectPillsAsPi checks both).
const HIDDEN: Record<string, string[]> = {
	"fence inside HTML": ["<pre>\n~~~\n</pre>\n\n~~~\n[[Done]]\n~~~", "<div>\n~~~\n\n~~~\n[[Done]]\n~~~"],
	"comment boundaries": ["<pre>\ntext <!-- note\n\nStatus [[Done]]\n-->\n</pre>"],
	"fence grammar": ["~~~js\u2028info\n[[Done]]\n~~~"],
	"display math after indented code": ["    code\n$$\n[[Done]]\n$$", "    code\n\n$$\n[[Done]]\n$$"],
};
// pi shows the pill as prose: drawn and counted.
const SHOWN: Record<string, string[]> = {
	"fence inside HTML": ["<pre>\n~~~\n</pre>\n\nStatus [[Done]]"],
	"comment boundaries": ["> <!-- note\n\nStatus [[Done]]", "- <!-- note\n\nStatus [[Done]]", "<!-- note -->\nStatus [[Done]]"],
	"fence grammar": ["\x60\x60\x60\ncode\n\x60\x60\x60~\nStatus [[Done]]", "~~~\ncode\n~~~\x60\nStatus [[Done]]"],
	"list-fence termination": ["- ~~~\n  body\n\nStatus [[Done]]", "- ~~~\n  body\n---\nStatus [[Done]]"],
};
for (const [name, inputs] of Object.entries(HIDDEN))
	for (const md of inputs)
		test(`${name}: pi shows no prose pill in ${JSON.stringify(md)}: none drawn, none counted`, () => {
			expect(piShown(id(md), ["[[Done p0q]]"])).toEqual([false]);
			expectPillsAsPi(ext, id(md));
		});
for (const [name, inputs] of Object.entries(SHOWN))
	for (const md of inputs)
		test(`${name}: pi shows the pill in ${JSON.stringify(md)} as prose: drawn and counted`, () => {
			expect(piShown(id(md), ["[[Done p0q]]"])).toEqual([true]);
			expectPillsAsPi(ext, id(md));
		});

// A small seeded generator (mulberry32), so a failure reproduces.
let seed = 0xb10c;
const rand = () => {
	seed = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
let ids = 0;
const pill = () => "[[Done p" + ids++ + "q]]";
const prose = () => pick(["Status ", "x ", ""]) + pill();
const B = "\x60";

/** A fence run: either character, length 3 to 5. */
const run = (char = pick([B, "~"]), length = int(3, 5)) => char.repeat(length);
/** A closing line for an opener run: the same run, longer, shorter, with mixed characters, spaces, indents. */
const closer = (open: string) => {
	const c = open[0];
	const other = c === B ? "~" : B;
	return " ".repeat(pick([0, 0, 1, 3, 4])) + pick([open, open + c, open.slice(1), open + other, open + other + c, open + "~" + B, other.repeat(open.length), open + "x"]) + pick(["", " ", "  "]);
};
const INFO = ["", "js", "js\u2028info", "a\u2029b", " ts", "a" + B + "b", "~x"];

type Make = () => string;
const CLASSES: Record<string, Make> = {
	"fence grammar": () => {
		const open = run();
		return " ".repeat(pick([0, 0, 1, 3])) + open + pick(INFO) + "\n" + pick(["code", pill(), "a\n\n" + pill()]) + "\n" + closer(open) + "\n" + prose() + pick(["", "\n" + closer(open) + "\n" + prose()]);
	},
	"fence inside HTML": () => {
		const open = run();
		const html = pick(["<pre>\n", "<div>\n", "<span>\n", "<?p\n", "<!X\n", "text\n<?p\n", "text\n<div>\n", "> <pre>\n> ", "- <div>\n  ", "> <div>\n> ", "- <pre>\n  "]);
		const end = pick(["</pre>\n", "?>\n", ">\n", "", "x " + pill() + "\n"]);
		const inner = html.startsWith(">") ? "> " : html.startsWith("-") ? "  " : "";
		return html + open + pick(INFO) + "\n" + inner + end + pick(["\n", "", inner + "\n"]) + pick([inner, ""]) + open + "\n" + pick([inner, ""]) + pill() + "\n" + pick([inner, ""]) + open + "\n" + prose();
	},
	"fence in container": () => {
		const open = run();
		// Not "- > " or "- - ": a quote or a list inside a list item whose lines go on indented to the outer item
		// (or lazily) is a limit of the reader's container model, outside this slice (report OPEN).
		const mark = pick(["- ", "> ", "1. ", "> - "]);
		const cont = mark.includes("-") || mark.includes("1") ? " ".repeat(mark.length) : "> ";
		return mark + open + pick(INFO) + "\n" + pick([cont, "", " "]) + pick(["body", pill()]) + "\n" + pick(["\n", "---\n", "***\n", "# h\n", "", cont + "\n", cont + "# x\n", cont + "    deep\n"]) + pick(["", cont, " "]) + prose() + pick(["", "\n" + cont + closer(open) + "\n" + prose()]);
	},
	comment: () =>
		pick(["", "> ", "- ", "1. ", "<pre>\ntext ", "<div>\ntext ", "<pre>\n", "<div>\n", "text\n", "> <pre>\n> x "]) +
		pick(["<!-- note", "<!-- note -->", "<!-->", "<!-- a -->tail " + pill(), "<!-- " + pill()]) +
		"\n" + pick(["", "\n", "\n\n"]) + pick(["", "  ", "> "]) + prose() + pick(["", "\n-->", "\n--> " + pill(), "\n</pre>", "\n-->\n</pre>"]) + "\n" + pick(["", "\n" + prose()]),
	// After a top-level paragraph, so that no list item before it takes the indented line (pi's list items and
	// math in them are a documented limit of the reader).
	"indented code then math": () => "Top.\n\n    " + pick(["code", pill()]) + "\n" + pick(["", "\n", "    more\n", "\n\n"]) + pick(["$$\n" + pill() + "\n$$", "\\[\n" + pill() + "\n\\]", "$$ " + pill() + " $$", "$$\n" + pill()]) + pick(["", "\n\n" + prose()]),
};

const CONTROL = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[ -\/]*[@-~]/g;
// A drawn pill as the terminal shows it: an optional edge, the icon, an en space, the label (words joined with
// no-break spaces), an optional edge.
const DRAWN = /[\ue0b4\ue0b6\u2590\u258c]?(?:[\ue000-\uf8ff]|[\u{f0000}-\u{ffffd}])\u2002([^\ue0b4\ue0b6\u2590\u258c\s]+(?:\u00a0[^\ue0b4\ue0b6\u2590\u258c\s]+)*)[\ue0b4\ue0b6\u2590\u258c]?/gu;
/**
 * What the terminal prints of pi's rendering of the drawn reply, each drawn pill written back as "[[label]]",
 * exactly: every other character is kept, and only the drawing's gap between two pills (two spaces for the
 * one written, index.ts PILL_GAP) is undone.
 */
const writtenBack = (drawn: string) =>
	piRender(drawn)
		.replace(CONTROL, "")
		.replace(DRAWN, (_, label: string) => "\u0003[[" + label.replace(/\u00a0/g, " ") + "]]\u0004")
		.replace(/\u0004  \u0003/g, "\u0004 \u0003")
		.replace(/[\u0003\u0004]/g, "");
const piText = (md: string) => piRender(md).replace(CONTROL, "");

const doneCount = (e: Loaded, md: string) => {
	const line = countLineOf(e, FOUR + md);
	const m = line?.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, "").match(/Done[\u00a0 ](\d+)/);
	return m ? Number(m[1]) - 1 : 0;
};

/** One generated round with a drawing: per class, replies made, failures, shown and over-protected pills. */
function round(e: Loaded, replies: number, start: number) {
	seed = start;
	const made: Record<string, number> = {};
	const realized: Record<string, number> = {};
	const over: Record<string, number> = {};
	const failures: string[] = [];
	let shownPills = 0;
	let drawnPills = 0;
	let overPills = 0;
	const names = Object.keys(CLASSES);
	for (let n = 0; n < replies; n++) {
		const used: string[] = [];
		const parts: string[] = [];
		for (let k = int(1, 3); k > 0; k--) {
			const name = pick(names);
			used.push(name);
			parts.push(CLASSES[name]());
		}
		const md = parts.join(pick(["\n\n", "\n"]));
		const marked = markedIds(md);
		const shown = piShown(md, marked.map((m) => "[[Done " + m + "]]"));
		const isDrawn = drawnIds(e, md);
		const drawn = e.draw(md);
		const line = countLineOf(e, md);
		const body = line === undefined ? drawn : drawn.replace("\n\n" + line, "");
		// A class is realized in a reply when pi hides one of its pills (code, math, comment) and shows another.
		for (const name of used) {
			made[name] = (made[name] ?? 0) + 1;
			if (shown.includes(false) && shown.includes(true)) realized[name] = (realized[name] ?? 0) + 1;
		}
		shownPills += shown.filter(Boolean).length;
		drawnPills += isDrawn.filter(Boolean).length;
		const hiddenDrawn = isDrawn.some((d, k) => d && !shown[k]);
		const miscounted = doneCount(e, md) !== drawnCount(e, md);
		if (hiddenDrawn || miscounted || writtenBack(body) !== piText(md)) failures.push(md);
		const missed = isDrawn.filter((d, k) => !d && shown[k]).length;
		overPills += missed;
		if (missed) for (const name of used) over[name] = (over[name] ?? 0) + 1;
	}
	return { made, realized, over, failures, shownPills, drawnPills, overPills };
}
// A pill pi shows as prose may stay undrawn only where the reader cannot prove pi's reading (over-protection):
// at most this share of the shown pills. A transform that draws nothing has a share of 1.
const OVER_PROTECTION_LIMIT = 0.15;
const positive = (r: ReturnType<typeof round>) => r.drawnPills > 0 && r.overPills <= OVER_PROTECTION_LIMIT * r.shownPills;

test("generated fences, comments and math: no pill drawn or counted where pi shows code, math or nothing", () => {
	const r = round(ext, 3000, 0xb10c);
	console.log("made per class", JSON.stringify(r.made));
	console.log("replies with a hidden and a shown pill, per class", JSON.stringify(r.realized));
	console.log("replies with an over-protected pill, per class", JSON.stringify(r.over));
	console.log("shown pills", r.shownPills, "; drawn", r.drawnPills, "; over-protected", r.overPills);
	console.log("failures", r.failures.length, JSON.stringify(r.failures.slice(0, 5)));
	for (const name of Object.keys(CLASSES)) expect(r.realized[name] ?? 0).toBeGreaterThan(0);
	expect(r.failures).toEqual([]);
	expect(positive(r)).toBe(true);
}, 300_000);

test("a transform that draws nothing fails the positive side", () => {
	const identity = { ...ext, draw: (md: string) => md } as Loaded;
	const r = round(identity, 300, 0xb10c);
	expect(r.shownPills).toBeGreaterThan(0);
	expect(positive(r)).toBe(false);
});

test("replaced-suffix sequences on one registration draw as a fresh registration", () => {
	seed = 0x5eed;
	const failures: string[] = [];
	const names = Object.keys(CLASSES);
	let sequences = 0;
	for (let n = 0; n < 1500; n++) {
		const prefix = CLASSES[pick(names)]() + "\n\n";
		const a = prefix + CLASSES[pick(names)]();
		const b = prefix + pick([CLASSES[pick(names)](), "plain", prose()]);
		const reused = load(truecolor);
		for (let at = prefix.length; at <= a.length; at += int(1, 4)) reused.draw(a.slice(0, at), true);
		reused.draw(a);
		for (let at = prefix.length; at <= b.length; at += int(1, 4)) {
			const p = b.slice(0, at);
			if (reused.draw(p, true) !== load(truecolor).draw(p, true)) failures.push(JSON.stringify([a, p]));
		}
		if (reused.draw(b) !== load(truecolor).draw(b)) failures.push(JSON.stringify([a, b]));
		sequences++;
	}
	console.log("replaced-suffix sequences", sequences, "; failures", failures.length, failures.slice(0, 3).join(" | "));
	expect(failures).toEqual([]);
}, 300_000);
