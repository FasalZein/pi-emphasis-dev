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
// CRLF and CR breaks: a streamed prefix may end with the CR of a CRLF whose LF has not arrived yet.
for (const [name, reply] of Object.entries({ ...REPLIES })) {
	REPLIES[name + " (CRLF)"] = reply.replace(/\n/g, "\r\n");
	REPLIES[name + " (CR)"] = reply.replace(/\n/g, "\r");
}

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

// A theme whose escapes name a version, and one colors object per version (as pi hands out one frozen colors
// object until the colors change), so a palette rebuild happens only at an explicit switch.
function versionedTheme() {
	let version = 1;
	let colors = { version };
	return {
		switch() {
			version++;
			colors = { version };
		},
		theme: {
			fg: (name: string, text: string) => "\x1b[38;" + name + version + "m" + text + "\x1b[39m",
			getFgAnsi: (name: string) => "\x1b[38;" + name + version + "m",
			getBgAnsi: (name: string) => "\x1b[48;" + name + version + "m",
			getColorMode: () => "256color",
			get colors() {
				return colors;
			},
		},
	};
}

test("a different reply under the same palette does not reuse the cached blocks", () => {
	const { theme: t } = versionedTheme();
	const ext = load(t);
	ext.draw("Intro [[Done]]\n\nMore [[Failed]]\n\nEnd", true);
	const other = "Other [[Passed]]\n\nMore [[Failed]]\n\nEnd";
	expect(ext.draw(other, true)).toBe(load(t).draw(other, true));
});

test("a theme change does not reuse the cached blocks of the same reply", () => {
	const v = versionedTheme();
	const ext = load(v.theme);
	const reply = "Intro [[Done]] **bold**\n\nMore [[Failed]]\n\nEnd";
	ext.draw(reply, true);
	v.switch();
	expect(ext.draw(reply, true)).toBe(load(v.theme).draw(reply, true));
});
