// Link regression inputs, each as a pi-tui differential (test/links-oracle.ts).
// Expected values come from pi's rendering of the raw reply: ordered (target, caption) spans, the printed text,
// and, for marked pills ("p<n>q"), whether pi shows them as prose (drawn and counted exactly then).
import { describe, expect, test } from "bun:test";
import { expectLinksKept, expectPillsAsPi, linkSpans } from "./links-oracle.ts";
import { type Loaded, load } from "./seam.ts";
import { truecolor } from "./truecolor.ts";

const ext = load(truecolor);
const both = (md: string) => {
	expectLinksKept(ext, md);
	expectPillsAsPi(ext, md);
};
const linked = (md: string) => {
	expect(linkSpans(md).length).toBeGreaterThan(0);
	both(md);
};

describe("1. HTML block lifetime", () => {
	for (const md of ["- <div>\n- [doc](/[[Done]])", "text\n<?proc?> [doc](/[[Done]])", "text\n<!DECL> [doc](/[[Done]])", "text\n  <div> [doc](/[[Done]])", '<div\u00a0data-x="z"> [doc](/[[Done]])'])
		test("pi's link stays in " + JSON.stringify(md), () => linked(md));
	for (const md of ["<pre>\n</style>\n[doc](/[[Done p0q]])\n</pre>", "<pre>\n</pre>\n<span>\n[doc](/[[Done p0q]])"])
		test("a pill pi shows in HTML text is drawn in " + JSON.stringify(md), () => both(md));
});

describe("2. a fence opener in HTML text excludes no definition", () => {
	for (const md of ["See [doc][ref**a**]\n\n<span>\n>\n~~~\n\n[ref**a**]: /x", "See [doc][ref**a**]\n\n<pre>\n</style>\n\n~~~\n</pre>\n\n[ref**a**]: /x"])
		test("pi's reference link stays in " + JSON.stringify(md), () => linked(md));
});

describe("3. reference boundaries", () => {
	for (const md of [
		"See [doc][a\\] b]\n\n[a\\]\nb]: /[[Done]]",
		"See [doc][r **x**\nr]\n\n[r **x** r]: /x",
		"See [doc][ a**b**]\n\n[\na**b**]: /x",
		"See [doc][a\\ b]\n\n[a\\\nb]: /[[Done]]",
		"See [doc][label > **b**]\n\n> [label\n> > **b**]: /[[Done]]",
		"See [doc][a b]\n\n[a" + "\n".repeat(9) + "b]: /[[Done]]",
	])
		test("pi's reference link stays in " + JSON.stringify(md), () => linked(md));
});

describe("4. tabbed link continuation", () => {
	for (const md of ["[doc](\n\t<abc/[[Done]]>)", '[doc](/x(y(z))[[Done]]\n\t"title")', '[text https://x.test/a](/ok\n\t"title [[Done p0q]]")'])
		test("pi's link stays and its title pill is not counted in " + JSON.stringify(md), () => linked(md));
});

describe("5. a possible reference keeps a real bare URL", () => {
	const P = "See [text https://x.test/a][r][[Done]]\n\n";
	for (const suffix of ["    [r]: /unused", "[r]:", "~~~\n~~~not closed\n[r]: /unused\n~~~", "-[r]: /unused", "[ r]: /ok", "prose\n[r]: /ok"])
		test("pi's links stay in " + JSON.stringify(P + suffix), () => linked(P + suffix));
	test('"-[r]:" is no definition: the pill is drawn', () => both("Status [x [[Done p0q]]][r]\n\n-[r]: /unused"));
});

describe("6. URL before email", () => {
	test("pi's www URL holding an @ stays whole", () => linked("See www.x@a.test/path/[[Done]]，状态"));
});

describe("7. a cached head never outlives the definition it read", () => {
	for (const [prefix, first, second] of [
		["See [text https://x.test/a][r][[Done]]\n\n", "- - [r]: /ok", "plain"],
		["Status [x [[Done p0q]]][label name]\n\n", "[label\nname]: /x", "plain"],
	])
		test("a replaced suffix draws as a fresh drawing: " + JSON.stringify(prefix + first) + " then " + JSON.stringify(prefix + second), () => {
			const reused = load(truecolor);
			reused.draw(prefix + first, true);
			reused.draw(prefix + first.slice(0, -1), true);
			reused.draw(prefix + first, true);
			const md = prefix + second;
			expect(reused.draw(md)).toBe(load(truecolor).draw(md));
			expectLinksKept(reused, md);
			expectPillsAsPi(load(truecolor), md);
		});
});

describe("8. the oracle", () => {
	const identity: Loaded = { draw: (md) => md, sections: () => ({}) };
	test("a transform that draws nothing fails the pill property", () => {
		expect(() => expectPillsAsPi(identity, "Status [[Done p0q]] here")).toThrow();
	});
	test("a transform that changes a caption fails the link property", () => {
		const recaption: Loaded = { draw: (md) => md.replace("[doc]", "[dog]"), sections: () => ({}) };
		expect(() => expectLinksKept(recaption, "See [doc](/x)")).toThrow();
	});
});
