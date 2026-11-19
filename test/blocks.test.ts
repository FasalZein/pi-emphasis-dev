// Fences, comments and math follow pi. Reference: pi's rendering of the raw reply (pi-tui's Markdown through
// test/oracle.ts and test/links-oracle.ts).
// (1) Named inputs: each pill is drawn exactly where pi shows it as prose, and the whole four-state count line
// counts exactly the drawn ones.
// (2) Limit inputs (DESIGN.md "Limits of the reader against pi's parser"): per pill, the drawing is pi's or the
// one of the reader before this slice (e90277b), recorded below: never worse.
// (3) A generated differential (test/blocks-gen.ts): no pill drawn or counted where pi hides it, every sure
// pill pi shows drawn, the whole count line, the printed text exact; a transform that draws nothing fails.
// (4) Replaced-suffix sequences on one registration equal a fresh drawing.
import { expect, test } from "bun:test";
import { CLASSES, int, passes, pick, realized, reply, reseed, verdict } from "./blocks-gen.ts";
import { drawnIds, expectPillsAsPi } from "./links-oracle.ts";
import { piShown } from "./oracle.ts";
import { load, type Loaded } from "./seam.ts";
import { truecolor } from "./truecolor.ts";

const ext = load(truecolor);
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

// Block and HTML boundaries: uppercase tags in a paragraph, HTML ends inside indented code, no-break space lines,
// HTML in containers, a second comment on a line, comments in HTML text, comment ranges, math after a comment
// or a closed HTML block.
const BOUNDARIES: string[] = ["text\n<PRE>\n~~~\n[[Done p0q]]\n~~~","text\n<DIV>\n~~~\n[[Done p1q]]\n~~~","<div>\n# h\n    code\n\n~~~\n[[Done p2q]]","<span>\n# h\n    code\n\n~~~\n[[Done p3q]]","<pre>\n# h\n    x\n    </pre>\n~~~\n[[Done p4q]]","<div>\n \n~~~\n\n~~~\n[[Done p5q]]","> <div>\n>\n> ~~~\n> ~~~\n> [[Done p6q]]","- <div>\n\n  ~~~\n  code\n  ~~~\n  [[Done p7q]]","> <span>\n>\n> ~~~\n> ~~~\n> [[Done p8q]]","<pre>\n<!-- A --> <!-- B\n\n[[Done p9q]]\n-->\n</pre>","<pre>\n<!-- A\n--> <!-- B\n[[Done p10q]]\n-->\n</pre>","<div>\n<!--1--> <!--2\n[[Done p11q]]\n-->\n\n","<pre>\n# <!-- x\n\n[[Done p12q]]\n-->\n</pre>","<pre>\n`<!--`\n\n[[Done p13q]]\n-->\n</pre>","<div>\n<!-- a\n \n[[Done p14q]]\n-->\n\n","<pre>\nx <!-- a\n</pre>\n\nStatus [[Done p15q]]","<pre>\nx <!-- a\n\n--> [[Done p16q]]\n</pre>","<pre>\ntext <!-- note\n\nStatus [[Done p17q]]\n--> [[Done p18q]]\n","<!-- ok -->\n$$\n[[Done p19q]]\n$$","<!--\n-->\n$$\n[[Done p20q]]\n$$","<!-- ok -->\n\\[\n[[Done p21q]]\n\\]","<pre></pre>\n    [[Done p22q]]\n$$\n[[Done p23q]]\n$$"];
// After unsure pending math no HTML block opens; a backtick in HTML text opens no code span; a list item that a
// blank line and a quote ended is not followed further.
BOUNDARIES.push("x $$\n\n<pre>\nx <!-- c\n\nStatus [[Done p46q]]", "<pre>\na `b\n[[Done p47q]]\nc` d\n</pre>", "- x\n\n> ```\n> a\n> ```\n\n\t```\n\tb\n\n\t```\n\n- S [[Done p48q]]");
// A comment on an HTML block's opening line, in HTML text read as indented code, or after a backslash; the
// order of "-->" and the end marker on the block's last line; the block boundary after that line.
BOUNDARIES.push(
	"<pre><!-- x\n[[Done p50q]]\n-->\n</pre>",
	"<div> <!-- x\n[[Done p51q]]\n-->\n\n",
	"<?x <!-- x\n[[Done p52q]]\n-->\n?>",
	"<![CDATA[ <!-- x\n[[Done p53q]]\n-->\n]]>",
	"<pre>\n# h\n    x\n    text <!-- c\n[[Done p54q]]\n-->\n</pre>",
	"<pre>\n\\<!-- [[Done p55q]] -->\n</pre>",
	"<pre>\nx <!-- y\n</pre> --> [[Done p56q]]",
	"<pre>\nx <!-- c\n--> </pre> <!-- y\n\nStatus [[Done p57q]]",
	"<pre>\nx <!-- c\n--> </pre>\n    [[Done p58q]]\n$$\n[[Done p59q]]\n$$",
	"<pre>\n# </pre>\n$$\n[[Done p60q]]\n$$",
);
for (const md of BOUNDARIES) test(`every pill as pi shows it in ${JSON.stringify(md)}`, () => expectPillsAsPi(ext, md));

// Limit inputs with the drawing of e90277b per pill (in order of first occurrence).
const LIMITS: [md: string, before: boolean[]][] = [["> <pre>\n> ```\n> </pre>\n> ~~~\n> ```~`\n> [[Done p24q]]",[false]],["- <pre>\n  ```\n  </pre>\n  ~~~\n  ```~`\n  [[Done p25q]]",[false]],["- <pre>\n  x <!-- note\n\n  [[Done p26q]]\n  -->\n  </pre>",[false]],["- <pre>\n  <!-->\n  [[Done p27q]]\n  -->\n  </pre>",[false]],["- ~~~\n  data\nxx#x\ntext\n  ~~~\n[[Done p28q]]",[true]],["- ~~~\n  data\nxx~~~\ntext\n  ~~~\n[[Done p29q]]",[true]],["- <!-- a\n  hello\nxx#x\ntext\n  ~~~\n[[Done p30q]]",[false]],["- first\nxx#x\ntext\n    x\n\n  ~~~\n[[Done p31q]]",[true]],["- ~~~\n  >\n[[Done p32q]]",[false]],["- ~~~\n  > [[Done p33q]]",[true]],["- <!-- x\n  >\n[[Done p34q]]\n-->",[false]],["- first\nxx#x\ntext\n    ~~~\n[[Done p35q]]",[true]],["- ~~~\n  data\nxx#x\n[[Done p36q]]",[false]],["-    <!-- x\n[[Done p37q]]",[false]],["- > x\n    # x\nx\n    ~~~\n[[Done p38q]]",[true]],["- - x\n    # x\nx\n    ~~~\n[[Done p39q]]",[true]],["- > ```a`b\n[[Done p40q]]\n    # x\n[[Done p41q]]\n    ~~~\nStatus [[Done p42q]]",[true,true,true]],["- - ~~~~~js\n [[Done p43q]]\n\n    x [[Done p44q]]\n     ~~~~~`~ \nStatus [[Done p45q]]",[true,false,true]]];
for (const [md, before] of LIMITS)
	test(`limit: no worse than before in ${JSON.stringify(md)}`, () => {
		const ids = [...new Set([...md.matchAll(/p\d+q/g)].map((m) => m[0]))];
		const shown = piShown(md, ids.map((x) => "[[Done " + x + "]]"));
		const drawn = drawnIds(ext, md);
		ids.forEach((x, k) => expect(drawn[k] === shown[k] || drawn[k] === before[k]).toBe(true));
	});

/** One generated round for a drawing: failures and per-class counts. */
function round(e: Loaded, replies: number, start: number) {
	reseed(start);
	const made: Record<string, number> = {};
	const real: Record<string, number> = {};
	const over: Record<string, number> = {};
	const failures: string[] = [];
	let shown = 0;
	let sure = 0;
	let missed = 0;
	for (let n = 0; n < replies; n++) {
		const r = reply();
		const v = verdict(e, r);
		for (const c of new Set(r.classes)) made[c] = (made[c] ?? 0) + 1;
		for (const c of realized(r, v)) real[c] = (real[c] ?? 0) + 1;
		shown += [...v.shown.values()].filter(Boolean).length;
		sure += [...r.sure].filter((x) => v.shown.get(x)).length;
		missed += v.missed.length;
		// An over-protected (not sure) pill is counted against the classes of its parts.
		r.partIds.forEach((ids, k) => {
			if (ids.some((x) => v.missed.includes(x))) over[r.classes[k]] = (over[r.classes[k]] ?? 0) + 1;
		});
		if (!passes(v)) failures.push(JSON.stringify({ md: r.md, hiddenDrawn: v.hiddenDrawn, sureMissed: v.sureMissed, tally: v.tallyOk, text: v.textOk }));
	}
	return { made, real, over, failures, shown, sure, missed };
}

test("generated fences, comments and math: no pill drawn or counted where pi hides it; every sure pill pi shows is drawn", () => {
	const r = round(ext, 3000, 0xb10c);
	console.log("replies with the class (once per reply)", JSON.stringify(r.made));
	console.log("replies where a part of the class has a pill pi hides and one pi shows", JSON.stringify(r.real));
	console.log("parts with an over-protected pill (not sure), per class", JSON.stringify(r.over));
	console.log("pills pi shows", r.shown, "; sure among them", r.sure, "; over-protected", r.missed);
	console.log("failures", r.failures.length, r.failures.slice(0, 5).join("\n"));
	for (const name of Object.keys(CLASSES)) expect(r.real[name] ?? 0).toBeGreaterThan(0);
	expect(r.failures).toEqual([]);
}, 300_000);

test("a transform that draws nothing fails the generated property", () => {
	const identity = { ...ext, draw: (md: string) => md } as Loaded;
	const r = round(identity, 200, 0xb10c);
	expect(r.sure).toBeGreaterThan(0);
	expect(r.failures.length).toBeGreaterThan(0);
});

test("replaced-suffix sequences on one registration draw as a fresh registration", () => {
	reseed(0x5eed);
	const failures: string[] = [];
	const names = Object.keys(CLASSES);
	let sequences = 0;
	for (let n = 0; n < 1500; n++) {
		const prefix = CLASSES[pick(names)]() + "\n\n";
		const a = prefix + CLASSES[pick(names)]();
		const b = prefix + pick([CLASSES[pick(names)](), "plain", "Status [[Done]]"]);
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
