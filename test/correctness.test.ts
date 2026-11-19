// Reader correctness: line endings and fences, link metadata, escapes and Setext headings follow
// pi's parser. Expected values come from pi's own rendering through test/oracle.ts (pi-tui's Markdown), from
// the CommonMark escape rule, or from the drawing of the equivalent unescaped or ATX form.
import { describe, expect, test } from "bun:test";
import { piLinks, piRender, piShown, piStyled } from "./oracle.ts";
import { countLineOf, load } from "./seam.ts";

const stub = {
	fg: (n: string, t: string) => "<" + n + ">" + t + "</>",
	getFgAnsi: (n: string) => "\x1b[38;" + n + "m",
	getBgAnsi: (n: string) => "\x1b[48;" + n + "m",
	getColorMode: () => "256color",
	colors: {},
};
const ext = load(stub);
const idsOf = (md: string) => [...md.matchAll(/p\d+q/g)].map((m) => m[0]);
/** Per id, whether the drawing turned the written pill [[… id]] into a drawn pill. */
const drawnIds = (md: string) => {
	const out = ext.draw(md);
	return idsOf(md).map((id) => out.includes(id) && !new RegExp(String.raw`\[\[[^\]]*${id}\]\]`).test(out));
};
const EOL = /\r\n|\r|\n/g;
/** Four pills of three states pi shows as prose: one more counted pill makes a count line. */
const FOUR = "[[Done]] [[Failed]] [[Passed]] [[Blocked]] text";

describe("line endings and fences", () => {
	for (const [name, eol] of [["LF", "\n"], ["CRLF", "\r\n"], ["CR", "\r"]] as const) {
		const replies = [
			["~~~ts", "[[Done p0q]]", "~~~", "", "x [[Done p1q]]"],
			["\x60\x60\x60", "[[Done p0q]]", "", "[[Done p1q]]", "\x60\x60\x60", "", "x [[Done p2q]]"],
			["$$", "[[Done p0q]]", "$$", "", "x [[Done p1q]]"],
			["Intro [[Done p0q]]", "", "    [[Done p1q]]", "", "<!--", "[[Done p2q]]", "-->", "", "- item [[Done p3q]]"],
		].map((l) => l.join(eol));
		for (const md of replies) {
			test(name + ": a pill is drawn exactly when pi shows it as prose in " + JSON.stringify(md), () => {
				expect(drawnIds(md)).toEqual(piShown(md, idsOf(md)));
			});
			test(name + ": the drawing keeps every line break as written in " + JSON.stringify(md), () => {
				expect(ext.draw(md).match(EOL)).toEqual(md.match(EOL));
			});
		}
	}
	test("CRLF: the count line goes in with its own breaks; the rest keeps the written ones", () => {
		const md = ["Intro [[Done]] line.", "", "~~~", "[[Failed]] [[Failed]]", "~~~", "", FOUR].join("\r\n");
		// pi shows five pills as prose: the count line holds them.
		expect(piShown(md, ["Intro", "[[Failed]] [[Failed]]"])).toEqual([true, false]);
		const line = countLineOf(ext, md);
		expect(line).toBeDefined();
		expect(ext.draw(md).replace("\n\n" + line, "")).toBe(ext.draw(md, true));
	});
});

describe("link metadata", () => {
	test("[spec](https://example.test/a__b) keeps pi's link target and stays a link", () => {
		const md = "[spec](https://example.test/a__b)";
		expect(piLinks(ext.draw(md))).toEqual(piLinks(md));
		expect(piLinks(md)).toEqual(["https://example.test/a__b"]);
		expect(piRender(ext.draw(md)).replace(/\x1b\][^\x1b]*\x1b\\/g, "")).toBe("spec");
	});
	const replies = [
		"See [docs](https://x.test/[[p0q]]) and [[Done p1q]]",

		"See [docs](/x \"T [[Done p0q]]\") and [[Done p1q]]",
		"See [docs](</a b> 'T [[Done p0q]]') and [[Done p1q]]",
		"See ![img](/i.png (T [[Done p0q]])) and [[Done p1q]]",
		"[docs]: /guide \"[[Done p0q]]\"\n\nText [[Done p1q]]",
		"[docs]: /guide\n'[[Done p0q]]'\n\nText [[Done p1q]]",
		"> [docs]: </g x> ([[Done p0q]])\n\nText [[Done p1q]]",
	];
	for (const md of replies) {
		test("only visible link text is drawn, and link targets stay pi's, in " + JSON.stringify(md), () => {
			expect(drawnIds(md)).toEqual(piShown(md, idsOf(md)));
			expect(piLinks(ext.draw(md))).toEqual(piLinks(md));
		});
	}
	// pi shows an autolink's target as its link text: the target is the link and is not drawn.
	for (const md of ["See <https://x.test/[[p0q]]> and [[Done p1q]]", "See https://x.test/[[p0q]]/a__b. and [[Done p1q]]", "See **www.x.test/a__[[p0q]]** and [[Done p1q]]"]) {
		test("an autolink target is not drawn and stays pi's link target in " + JSON.stringify(md), () => {
			expect(piLinks(md)[0]).toContain("p0q");
			expect(drawnIds(md)).toEqual([false, true]);
			expect(piLinks(ext.draw(md))).toEqual(piLinks(md));
		});
	}
	// A pill or bold in link text is not drawn and not counted, so the link stays
	// the working link pi draws (an escape in the text would break it). Expected: pi's link targets and visible
	// text of the reply alone.
	for (const md of ["See [**it** now](/a__b) too", "See [it ✓ → **x**][r] too\n\n[r]: /a__b", "See [**it**] too\n\n[**it**]: /a__b", "See ![**it** [[Done p0q]]](/i.png) too", "See [it [[Done p0q]]](/x) too", "See [[[Done p0q]] it][r] too\n\n[r]: /x", "See [[Done p0q]](/x) too"]) {
		test("link text is left to pi: the same link targets and visible text as pi alone in " + JSON.stringify(md), () => {
			expect(piLinks(ext.draw(md))).toEqual(piLinks(md));
			expect(piStyled(ext.draw(md))).toBe(piStyled(md));
		});
	}
	test("pi links bold link text; a pill in link-shaped text is not counted", () => {
		expect(piLinks("See [**it** now](/a__b) too")).toEqual(["/a__b"]);
		expect(countLineOf(ext, "See [it [[Done]]](/x) too.\n\n" + FOUR)).toBeUndefined();
	});
	test("a pill in reference definition is not counted", () => {
		const md = '[docs]: /guide "[[Done]]"\n\n' + FOUR;
		expect(piShown(md, ['"[[Done]]"'])).toEqual([false]);
		expect(countLineOf(ext, md)).toBeUndefined();
	});
});

describe("escapes", () => {
	test("an odd backslash run before [[ leaves the pill as written", () => {
		for (const md of ["\\[[Done]] x", "x \\\\\\[[Done]] y", "x [[Done\\]] y"]) expect(ext.draw(md)).toBe(md);
	});
	test("an escaped pill is not counted", () => {
		const md = "Escaped \\[[Done]] here.\n\n" + FOUR;
		expect(countLineOf(ext, md)).toBeUndefined();
	});
	test("\\**Check:** next gets no icon and no color: pi shows no bold", () => {
		const md = "\\**Check:** next";
		expect(piRender(md)).toBe("*Check:* next");
		expect(ext.draw(md)).toBe(md);
		expect(ext.draw("x \\**a** b **c** d")).toBe("x \\**a** b " + ext.draw("**c** d").replace(/^.*?\*\*/, "**"));
	});
	test("an even backslash run behaves as no backslash", () => {
		// pi shows one backslash, then the pill text or the bold label.
		expect(piRender("a \\\\[[Done]] b")).toBe("a \\[[Done]] b");
		expect(ext.draw("a \\\\[[Done]] b")).toBe(ext.draw("a [[Done]] b").replace("a ", "a \\\\"));
		expect(ext.draw("x \\\\**Check:** next")).toBe(ext.draw("x **Check:** next").replace("x ", "x \\\\"));
	});
});

describe("Setext headings", () => {
	for (const [title, under] of [["Heading [[Done]]", "===="], ["Heading [[Failed]] $5", "---"]]) {
		const md = title + "\n" + under;
		const atx = "# " + title;
		test("pi shows " + JSON.stringify(md) + " as the heading " + JSON.stringify(atx) + " and the drawing follows", () => {
			expect(piRender(md)).toBe(piRender(atx));
			expect(ext.draw(md)).toBe(ext.draw(atx).slice(2) + "\n" + under);
			expect(countLineOf(ext, md + "\n\n" + FOUR)).toBe(countLineOf(ext, atx + "\n\n" + FOUR));
		});
	}
	test("a paragraph of two lines over an underline is one heading for pi, and neither line is drawn", () => {
		const md = "Two [[Done]]\nlines [[Failed]]\n==";
		expect(piRender(md)).toBe(piRender("# Two [[Done]]") + "\n" + "lines [[Failed]]");
		expect(ext.draw(md)).toBe(md);
	});
});

describe("oracle", () => {
	test("a link target in OSC 8 is not visible prose; the target is read separately", () => {
		expect(piShown("[spec](https://example.test/p0q)", ["p0q", "spec"])).toEqual([false, true]);
		expect(piLinks("[spec](https://example.test/p0q)")).toEqual(["https://example.test/p0q"]);
	});
});

// Cache, CRLF and link edge cases that an earlier reader got wrong.
describe("reader edge cases", () => {
	test("a head cached from another reply does not split its CRLF: equal to the uncached drawing, breaks as written", () => {
		const score = "[[Done]] [[Failed]] [[Passed]] [[Blocked]] [[Needs you]] text";
		const streamed = load(stub);
		streamed.draw("Intro\r\rX", true);
		const other = "Intro\r\r\n" + score;
		const out = streamed.draw(other);
		expect(out).toBe(load(stub).draw(other));
		const line = countLineOf(ext, other)!;
		expect(out.replace("\n\n" + line, "").match(EOL)).toEqual(other.match(EOL));
	});
	// Link targets: pi's exact target survives the drawing, and no pill hidden in metadata is drawn.
	for (const md of [
		'[s](/a__b\n "title [[Done p0q]]")',
		'[r]:\n   /a__b "[[Done p0q]]"\n\n[s][r]',
		'- item\n- [r]: /a__b "[[Done p0q]]"\n\n[read][r]',
		"[log https://x.test/a__b]",
		"a__b@example.org",
		"> $x$ [s](/a__b)",
		"- $x$\n- [s](/a__b)",
		"- cost \\$5 and [s](/a__b)",
		'[outer [inner](/u)](/bad "[[Done p0q]]")',
	]) {
		test("link targets stay pi's and pills are drawn where pi shows them in " + JSON.stringify(md), () => {
			expect(piLinks(md).length).toBeGreaterThan(0);
			expect(piLinks(ext.draw(md))).toEqual(piLinks(md));
			expect(drawnIds(md)).toEqual(piShown(md, idsOf(md)));
		});
	}
	test("a definition ends its block: a closed math block right after it is math, as pi shows it", () => {
		const md = "[r]: /x\n$$\n[[Done p0q]]\n$$";
		expect(piShown(md, ["p0q"])).toEqual([false]);
		expect(drawnIds(md)).toEqual([false]);
	});
	// Setext: a lazy or four-space underline makes no heading for pi; the pill stays drawn.
	for (const md of ["> Title [[Done p0q]]\n===", "Title [[Done p0q]]\n    ===", "> Title [[Done p0q]]\n> ==="]) {
		test("a pill is drawn exactly when pi shows it outside a heading in " + JSON.stringify(md), () => {
			const heading = piStyled(md).includes("{H}");
			expect(piShown(md, ["p0q"])).toEqual([true]);
			expect(drawnIds(md)).toEqual([!heading]);
		});
	}
	// Bold: the drawing colors exactly the spans pi shows bold.
	const [open, close] = ext.draw("**\u0000**").split("\u0000").map((s) => s.replace(/\*\*/g, ""));
	const drawnBold = (md: string) => [...ext.draw(md).split(open).slice(1)].map((s) => s.split(close)[0].replace(/\*\*$/, ""));
	const piBold = (md: string) => [...piStyled(md).matchAll(/\{B\}(.*?)\{\/B\}/g)].map((m) => m[1]);
	for (const md of ["x \\** then **actual** after", "\\**Check:** next", "x \\** a **b**", "a \\**b** c **d**"]) {
		test("the drawing colors the bold spans pi shows in " + JSON.stringify(md), () => {
			expect(drawnBold(md)).toEqual(piBold(md));
		});
	}
});
