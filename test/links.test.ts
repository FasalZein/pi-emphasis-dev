// Links stay pi's links: for each reply, every link pi draws keeps its exact target (OSC 8) and visible text
// after the extension decorates the reply, and a pill pi shows as prose next to a link is drawn and counted.
// Expected values come from pi's own rendering of the raw reply (test/oracle.ts, pi-tui's Markdown).
import { describe, expect, test } from "bun:test";
import { readBlocks, strongPairs } from "../reader.ts";
import { piLinks, piRender, piShown, piStyled } from "./oracle.ts";
import { countLineOf, load } from "./seam.ts";
import { truecolor } from "./truecolor.ts";

const ext = load(truecolor);
const CONTROL = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[ -\/]*[@-~]/g;
/** What the terminal prints of pi's rendering of md. */
const visible = (md: string) => piRender(md).replace(CONTROL, "");
/** Four pills pi shows as prose: one more counted pill makes a count line. */
const FOUR = "Text [[Done]] [[Failed]] [[Passed]] [[Blocked]].\n\n";
const DRAWN_ID = /(?:[\ue000-\uf8ff]|[\u{f0000}-\u{ffffd}])[\s\u2002]Done\sp0q/u;

/** pi links md to the same targets with the same visible text before and after the drawing. */
function keepsLinks(md: string) {
	const targets = piLinks(md);
	expect(targets.length).toBeGreaterThan(0);
	expect(piLinks(ext.draw(md))).toEqual(targets);
	expect(visible(ext.draw(md))).toBe(visible(md));
}

// Each class: the review's input, plus a variant with a pill or a bold pair in the link (since b66adb7 a lone
// "__" pairs with nothing, so the review's "a__b" draws nothing on its own).
describe("HTML next to links", () => {
	for (const md of [
		"<https://x.test/a__b>",
		"<b>ok</b> [s](/a__b)",
		"<pre>\ntext\n</pre>\n[s](/a__b)",
		"<https://x.test/[[Done]]>",
		"<https://x.test/a**b**c> and **bold**",
		"<b>ok</b> [s](/[[Done]])",
		"<pre>\ntext\n</pre>\n[s](/[[Done]])",
		"<!X decl>\n[s](/[[Done]])",
	])
		test("a link after or as a leading \"<\" keeps pi's target in " + JSON.stringify(md), () => keepsLinks(md));
	test("a pill in an HTML block is still drawn where pi shows it as prose", () => {
		const md = "<div>\n[[Done p0q]] text\n</div>";
		expect(piShown(md, ["[[Done p0q]]"])).toEqual([true]);
		expect(visible(ext.draw(md))).toMatch(DRAWN_ID);
	});
});

describe("reference-link boundaries", () => {
	for (const md of [
		"See [doc][a\\]__b]\n\n[a\\]__b]: /good",
		"See [doc][a__b]\n\n- - [a__b]: /good",
		"See [doc][label name]\n\n[label\nname]: /a__b",
		"See [doc][a\\]**b**]\n\n[a\\]**b**]: /good",
		"See [doc][a**b**c]\n\n- - [a**b**c]: /good",
		"See [doc][label name]\n\n[label\nname]: /a**b**c",
		"See [doc][label name]\n\n[label\nname]: /[[Done]]",
		"See [d**o**c][label name]\n\n> - [label\n> name]: /x",
		"See [d**o**c][a b]\n\n[a\n\nb]: /x",
		"See [d**o**c][label > name]\n\n[label\n> name]: /x",
	])
		test("a reference link keeps pi's target in " + JSON.stringify(md), () => keepsLinks(md));
	for (const md of ["Status [x [[Done p0q]]][r]\n\n~~~\n[r]: /unused\n~~~", "Status [[Done p0q]] [r]\n\n\x60\x60\x60\n[r]: /unused\n\x60\x60\x60"])
		test("a definition inside a fence defines nothing: the pill is drawn in " + JSON.stringify(md), () => {
			expect(piLinks(md)).toEqual([]);
			expect(piShown(md, ["Done p0q"])).toEqual([true]);
			expect(visible(ext.draw(md))).toMatch(DRAWN_ID);
		});
	test("a definition whose label goes over two lines is hidden by pi: its pill is not counted", () => {
		const md = FOUR + "See [doc][label name]\n\n[label\nname]: /x \"[[Done]]\"";
		expect(piShown(md, ["label"])).toEqual([false]);
		expect(countLineOf(ext, md)).toBeUndefined();
	});
});

describe("a tab in a two-line link", () => {
	const md = '[doc](/a__b\n\t"title [[Done]]")';
	test("pi links the text to its target; the drawing keeps it", () => {
		expect(piLinks(md)).toEqual(["/a__b"]);
		keepsLinks(md);
		keepsLinks('[doc](/[[Done]]\n\t"title")');
	});
	test("the title's pill is hidden by pi and not counted", () => {
		expect(countLineOf(ext, FOUR + md)).toBeUndefined();
	});
});

describe("bare URL boundaries", () => {
	for (const md of ["See [text https://x.test/a__b][r]", "See [text https://x.test/[[Done]]][r]", "See [text https://x.test/a**b**c][r] **x**", "See [t https://x.test/[[Done]]][r][]", "See https://x.test/**y**，**b**"])
		test("an undefined reference after a bare URL leaves pi's URL whole in " + JSON.stringify(md), () => keepsLinks(md));
	for (const md of ["See https://x.test/a，状态[[Done p0q]]", "See www.x.test/a。[[Done p0q]]", "Mail a@x.test，[[Done p0q]]"])
		test("pi's bare URL ends at CJK punctuation: the pill after it is drawn in " + JSON.stringify(md), () => {
			expect(piShown(md, ["Done p0q"])).toEqual([true]);
			expect(piLinks(ext.draw(md))).toEqual(piLinks(md));
			expect(visible(ext.draw(md))).toMatch(DRAWN_ID);
		});
	test("the strong-pairs reader cuts the URL where pi does: bold after it pairs as pi pairs it", () => {
		const md = "See https://x.test/a，**状态**";
		expect(piStyled(md)).toBe("See https://x.test/a，{B}状态{/B}");
		const [line] = readBlocks([md]).read;
		expect(strongPairs(md, line.literal).pairs).toEqual([[md.indexOf("**"), md.lastIndexOf("**")]]);
		expect(piLinks(ext.draw(md))).toEqual(piLinks(md));
		expect(visible(ext.draw(md))).toBe(visible(md));
	});
});
