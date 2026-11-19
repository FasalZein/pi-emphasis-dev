// Generated replies for the block reader's differential (test/blocks.test.ts): fences, comments and math next
// to HTML, lists and quotes, and the verdict of one drawing against pi's rendering (test/oracle.ts).
// Each pill carries a unique id recorded against the part that generated it. A "sure" pill sits where the
// reader can prove pi's reading (after a blank line at top level, after the part's block): when pi shows it,
// it must be drawn. Any pill pi hides (code, math, comment) must not be drawn or counted.
import { drawnIds, markedIds } from "./links-oracle.ts";
import { piRender, piShown, piStyled } from "./oracle.ts";
import { countLineOf, type Loaded } from "./seam.ts";

// A small seeded generator (mulberry32), so a failure reproduces.
let seed = 0;
export const reseed = (s: number) => {
	seed = s;
};
const rand = () => {
	seed = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
export const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
export const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

let ids = 0;
let sure = new Set<string>();
const pill = (isSure = false) => {
	const id = "p" + ids++ + "q";
	if (isSure) sure.add(id);
	return "[[Done " + id + "]]";
};
const prose = () => pick(["Status ", "x ", ""]) + pill();
/** A sure pill after the part: a blank line, then a top-level paragraph. */
const after = () => "\n\nStatus " + pill(true);
const B = "\x60";
const NBSP = "\u00a0";

const run = (char = pick([B, "~"]), length = int(3, 5)) => char.repeat(length);
const closer = (open: string) => {
	const c = open[0];
	const other = c === B ? "~" : B;
	return " ".repeat(pick([0, 0, 1, 3, 4])) + pick([open, open + c, open.slice(1), open + other, open + other + c, open + "~" + B, other.repeat(open.length), open + "x"]) + pick(["", " ", "  "]);
};
const INFO = ["", "js", "js\u2028info", "a\u2029b", " ts", "a" + B + "b", "~x"];
// Top-level HTML openers and their closers, both cases, all CommonMark types (1, 3-7).
const HTML: [open: string, close: string][] = [
	["<pre>", "</pre>"], ["<PRE>", "</PRE>"], ["<script>", "</script>"], ["<?p", "?>"], ["<!X", ">"], ["<![CDATA[", "]]>"],
	["<div>", ""], ["<DIV>", ""], ["<span>", ""], ["<P>", ""],
];

type Make = () => string;
export const CLASSES: Record<string, Make> = {
	"fence grammar": () => {
		const open = run();
		return " ".repeat(pick([0, 0, 1, 3])) + open + pick(INFO) + "\n" + pick(["code", pill(), "a\n\n" + pill()]) + "\n" + closer(open) + "\n" + prose() + pick(["", "\n" + closer(open) + "\n" + prose()]) + after();
	},
	"fence inside HTML": () => {
		const [o, c] = pick(HTML);
		const open = run();
		const second = pick([open, run(open[0] === B ? "~" : B)]);
		const lead = pick(["", "", "text\n", "# h\n", "# h\n    code\n", "# h\n    x\n    " + c + "\n"]);
		const end = pick([c + "\n", "", "x " + pill() + "\n", NBSP + "\n", " " + NBSP + "\n"]);
		return lead + o + "\n" + open + pick(INFO) + "\n" + end + pick(["\n", "", NBSP + "\n"]) + second + "\n" + pill() + "\n" + pick([second, open]) + "\n" + prose() + after();
	},
	"HTML in container": () => {
		const mark = pick(["> ", "- "]);
		const cont = mark === "> " ? "> " : "  ";
		const blank = mark === "> " ? pick([">", "> ", ""]) : "";
		const [o] = pick([["<div>"], ["<span>"], ["<pre>"]]);
		const open = run();
		return mark + o + "\n" + blank + "\n" + cont + open + "\n" + cont + pick(["code", pill()]) + "\n" + cont + open + "\n" + cont + prose() + after();
	},
	"fence in container": () => {
		const open = run();
		const mark = pick(["- ", "> ", "1. ", "> - "]);
		const cont = mark.includes("-") || mark.includes("1") ? " ".repeat(mark.length) : "> ";
		const q = mark === "> - " ? "> " + " ".repeat(2) : cont;
		return mark + open + pick(INFO) + "\n" + pick([q, "", " "]) + pick(["body", pill()]) + "\n" + pick(["\n", "---\n", "***\n", "# h\n", "", q + "\n", q + "# x\n", q + "    deep\n"]) + pick(["", q, " "]) + prose() + pick(["", "\n" + q + closer(open) + "\n" + prose()]) + after();
	},
	comment: () =>
		pick(["", "> ", "- ", "1. ", "<pre>\ntext ", "<div>\ntext ", "<pre>\n", "<div>\n", "<PRE>\n", "text\n", "<pre>\n# ", "<pre>\n<!-- A --> "]) +
		pick(["<!-- note", "<!-- note -->", "<!-->", "<!-- a -->tail " + pill(), "<!-- " + pill(), "<!-- a --> <!-- b"]) +
		"\n" + pick(["", "\n", "\n\n", NBSP + "\n"]) + pick(["", "  ", "> "]) + prose() + pick(["", "\n-->", "\n--> " + pill(), "\n--> <!-- c", "\n</pre>", "\n-->\n</pre>", "\n-->\n</PRE>"]) + "\n" + pick(["", "\n" + prose()]) + after(),
	"comment then math": () => pick(["<!-- ok -->", "<!--\n-->", "<!-- a\nb -->", "<!-->"]) + "\n" + pick(["$$\n" + pill() + "\n$$", "\\[\n" + pill() + "\n\\]", "$$ " + pill() + " $$"]) + after(),
	"indented code then math": () =>
		pick(["Top.\n\n", "<pre></pre>\n", "<!-- c -->\n", "~~~\nx\n~~~\n", ""]) + "    " + pick(["code", pill()]) + "\n" + pick(["", "\n", "    more\n", "\n\n"]) +
		pick(["$$\n" + pill() + "\n$$", "\\[\n" + pill() + "\n\\]", "$$ " + pill() + " $$", "$$\n" + pill()]) + after(),
};

const CONTROL = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[ -\/]*[@-~]/g;
const CSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]/g;
// A drawn pill as the terminal shows it: an optional edge, the icon, an en space, the label (words joined with
// no-break spaces), an optional edge.
const DRAWN = /[\ue0b4\ue0b6\u2590\u258c]?(?:[\ue000-\uf8ff]|[\u{f0000}-\u{ffffd}])\u2002([^\ue0b4\ue0b6\u2590\u258c\s]+(?:\u00a0[^\ue0b4\ue0b6\u2590\u258c\s]+)*)[\ue0b4\ue0b6\u2590\u258c]?/gu;
/**
 * What the terminal prints of pi's rendering of the drawn reply, each drawn pill written back as "[[label]]",
 * exactly: only the drawing's gap between two pills (two spaces for the one written, index.ts PILL_GAP) is undone.
 */
const writtenBack = (drawn: string) =>
	piRender(drawn)
		.replace(CONTROL, "")
		.replace(DRAWN, (_, label: string) => "\u0003[[" + label.replace(/\u00a0/g, " ") + "]]\u0004")
		.replace(/\u0004  \u0003/g, "\u0004 \u0003")
		.replace(/[\u0003\u0004]/g, "");
const FOUR = "Text [[Done]] [[Failed]] [[Passed]] [[Blocked]].\n\n";
/** The whole count line of FOUR + md as "word n" entries, sorted; [] without a count line. */
const tally = (e: Loaded, md: string) => {
	const line = countLineOf(e, FOUR + md);
	if (line === undefined) return [];
	return [...line.replace(CSI, "").matchAll(/\u2002([^\ue0b4\ue0b6\u2590\u258c]+?)[\u00a0 ](\d+)/gu)].map((m) => m[1].replace(/\u00a0/g, " ") + " " + m[2]).sort();
};

export interface Reply {
	md: string;
	/** The generating class of each part, in order. */
	classes: string[];
	/** Per part, its pill ids. */
	partIds: string[][];
	sure: Set<string>;
}
/** A reply of one to three parts, joined by a blank line or a line break. */
export function reply(): Reply {
	sure = new Set();
	const names = Object.keys(CLASSES);
	const classes: string[] = [];
	const parts: string[] = [];
	for (let k = int(1, 3); k > 0; k--) {
		const name = pick(names);
		classes.push(name);
		parts.push(CLASSES[name]());
	}
	const md = parts.join(pick(["\n\n", "\n"]));
	return { md, classes, partIds: parts.map(markedIds), sure };
}

export interface Verdict {
	/** Ids pi shows as prose. */
	shown: Map<string, boolean>;
	/** Ids drawn where pi hides them. */
	hiddenDrawn: string[];
	/** Sure ids pi shows that are not drawn. */
	sureMissed: string[];
	/** Other ids pi shows that are not drawn (over-protection the reader may leave). */
	missed: string[];
	/** The count line is exactly FOUR's states plus each drawn id, or absent when nothing more is drawn. */
	tallyOk: boolean;
	/** The printed text equals pi's, drawn pills written back. */
	textOk: boolean;
}
export function verdict(e: Loaded, r: Reply): Verdict {
	const ids = markedIds(r.md);
	// A pill in a heading is never drawn (DESIGN.md: pills in headings stay as written): pi's heading text counts
	// as not shown.
	const headings = [...piStyled(r.md).matchAll(/\{H\}([\s\S]*?)\{\/H\}/g)].map((m) => m[1]).join("\n");
	const shownList = piShown(r.md, ids.map((id) => "[[Done " + id + "]]")).map((s, k) => s && !headings.includes("[[Done " + ids[k] + "]]"));
	const shown = new Map(ids.map((id, k) => [id, shownList[k]]));
	const drawn = drawnIds(e, r.md);
	const hiddenDrawn = ids.filter((id, k) => drawn[k] && !shownList[k]);
	const notDrawn = ids.filter((id, k) => !drawn[k] && shownList[k]);
	// Each drawn occurrence counts (an id occurs once in a generated reply).
	const n = drawn.filter(Boolean).length;
	const t = tally(e, r.md);
	const tallyOk = JSON.stringify(t) === JSON.stringify(n === 0 ? [] : ["Blocked 1", "Done " + (1 + n), "Failed 1", "Passed 1"]);
	const out = e.draw(r.md);
	const line = countLineOf(e, r.md);
	const body = line === undefined ? out : out.replace("\n\n" + line, "");
	const textOk = writtenBack(body) === piRender(r.md).replace(CONTROL, "");
	return { shown, hiddenDrawn, sureMissed: notDrawn.filter((id) => r.sure.has(id)), missed: notDrawn.filter((id) => !r.sure.has(id)), tallyOk, textOk };
}
/** The verdict holds every required property. */
export const passes = (v: Verdict) => v.hiddenDrawn.length === 0 && v.sureMissed.length === 0 && v.tallyOk && v.textOk;
/** The classes realized in a reply, once each: a part of the class has one pill pi hides and one pi shows. */
export function realized(r: Reply, v: Verdict): Set<string> {
	const out = new Set<string>();
	r.partIds.forEach((part, k) => {
		const s = part.map((id) => v.shown.get(id));
		if (s.includes(true) && s.includes(false)) out.add(r.classes[k]);
	});
	return out;
}
