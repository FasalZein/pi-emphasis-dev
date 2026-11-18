// The finished-block cache (decorate in index.ts): one extension instance streams a reply prefix by prefix and
// must draw each prefix, and the complete reply, exactly as a fresh instance (no cache) draws it.
// Differential: the reference is the drawing without a cache. Each reply holds a block that opens before a
// blank line and goes on after it, so a wrong finished-block boundary there changes the drawing.
import { expect, test } from "bun:test";
import { load } from "./seam.ts";

const theme = {
	fg: (name: string, text: string) => "\x1b[38;" + name + "m" + text + "\x1b[39m",
	getFgAnsi: (name: string) => "\x1b[38;" + name + "m",
	getBgAnsi: (name: string) => "\x1b[48;" + name + "m",
	getColorMode: () => "256color",
	colors: {},
};
const F = "\x60\x60\x60";
const REPLIES: Record<string, string> = {
	"a fence that opens before a blank line and closes after it": "Intro [[Done]]\n\n" + F + "\n[[Done]] in code\n\n[[Failed]] in code\n" + F + "\n\nAfter [[Passed]]\n",
	"a list item that goes on after a blank line": "- item [[Done]]\n\n    continued [[Failed]] **bold**\n\n      indented [[Done]]\n\nEnd [[Passed]]",
	"a block quote around a blank line": "> quoted [[Done]]\n>\n> more [[Failed]]\n\nAfter [[Done]]",
	"a math block with a blank line inside": "Intro [[Done]]\n\n$$\nx [[Done]]\n\ny\n$$\n\nAfter [[Failed]]",
	"pending math up to the reply's end": "Intro [[Done]]\n\n$$ x^2\n\nmore [[Failed]]\n\nend [[Done]]",
	"indented code around a blank line": "Intro\n\n    [[Done]] code\n\n    [[Failed]] code\n\nAfter [[Passed]]",
	"an HTML comment block over a blank line": "Intro\n\n<!--\n[[Done]]\n\n-->\nafter [[Failed]]\n\nEnd [[Done]]",
	"a reply that ends with a blank line": "Intro [[Done]]\n\n## Status\n\n[[Done]] [[Failed]] [[Needs you]] [[Passed]] [[Blocked]]\n\n",
	"a count line over cached blocks": "Intro **Result:** x\n\n- [[Done]] a\n- [[Failed]] b\n\nText [[Passed]] [[Blocked]] [[Needs you]]\n\nEnd ✓ → [[Done]]",
};

for (const [name, reply] of Object.entries(REPLIES)) {
	test("streamed through one instance, every prefix draws as without a cache: " + name, () => {
		const streamed = load(theme);
		for (let i = 1; i <= reply.length; i++) {
			const prefix = reply.slice(0, i);
			expect(streamed.draw(prefix, true)).toBe(load(theme).draw(prefix, true));
		}
		expect(streamed.draw(reply)).toBe(load(theme).draw(reply));
	});
}

test("a different reply and a theme change do not reuse the cached blocks", () => {
	let colors = 1;
	const swapping = { ...theme, getFgAnsi: (name: string) => "\x1b[38;" + name + colors + "m" };
	const ext = load({ get fg() { return swapping.fg; }, get getFgAnsi() { return swapping.getFgAnsi; }, getBgAnsi: theme.getBgAnsi, getColorMode: theme.getColorMode, get colors() { return { colors }; } });
	const first = "Intro [[Done]]\n\nMore [[Failed]]\n\nEnd";
	ext.draw(first, true);
	const other = "Other [[Passed]]\n\nMore [[Failed]]\n\nEnd";
	expect(ext.draw(other, true)).toBe(load(swapping).draw(other, true));
	colors = 2;
	expect(ext.draw(other, true)).toBe(load(swapping).draw(other, true));
});
