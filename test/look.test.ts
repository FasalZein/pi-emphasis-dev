import { describe, expect, test } from "bun:test";
import { Theme as PiTheme } from "@earendil-works/pi-coding-agent";
import { rgbColor } from "@earendil-works/pi-tui";
import { THEME_TOKENS } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme-tokens.js";
import { DEFAULT_SETTINGS, readSettings } from "../index.ts";
import { countPlace, readMarkdown } from "../reader.ts";
import { countLineOf, countWords, load, type Theme } from "./seam.ts";
import { fgEsc, RGB, truecolor } from "./truecolor.ts";

const draw = (md: string, settings: Partial<ReturnType<typeof readSettings>> = {}, streaming = false) =>
	load(truecolor, { ...DEFAULT_SETTINGS, ...settings }).draw(md, streaming);
const ext = load(truecolor);
// The count line's visible words and counts, as "[[Done 2]] [[Failed 1]]".
const countLine = (md: string) => countWords(countLineOf(ext, md));

describe("pill colors from the theme", () => {
	test("a panel mixes 22% of the tone color into toolPendingBg, with the tone color as text", () => {
		// success (195,232,141) over toolPendingBg (26,27,38): 0.22 * c + 0.78 * bg, rounded: (63,72,61).
		expect(draw("[[Done]]")).toContain("\x1b[48;2;63;72;61m\x1b[38;2;195;232;141m");
	});
	test("asks are solid: the warning color as background, with the darker of text and toolPendingBg as ink", () => {
		expect(draw("[[Needs you]]")).toContain("\x1b[48;2;255;199;119m\x1b[38;2;26;27;38m");
		expect(draw("[[Decision]]")).toContain("\x1b[48;2;255;199;119m\x1b[38;2;26;27;38m");
	});
	test("status pills keep the warning panel, so asks and status differ", () => {
		expect(draw("[[Unverified]]")).not.toContain("\x1b[48;2;255;199;119m");
	});
	test("a hex color in the settings replaces the tone color", () => {
		const colors = { ...DEFAULT_SETTINGS.colors, success: "#112233" };
		expect(draw("[[Done]]", { colors })).toContain("\x1b[38;2;17;34;51m");
	});
	test("a theme color name in the settings replaces the tone color", () => {
		const colors = { ...DEFAULT_SETTINGS.colors, success: "accent" };
		expect(draw("[[Done]]", { colors })).toContain("\x1b[38;2;130;170;255m");
	});
	test("fill text draws the word in the tone color with no background and no edges", () => {
		const out = draw("[[Done]]", { fill: { ...DEFAULT_SETTINGS.fill, success: "text" } });
		expect(out).not.toMatch(/\x1b\[48;2/);
		expect(out).not.toMatch(/[\ue0b4\ue0b6]/);
	});
	test("a 256-color terminal maps a hex color to the nearest xterm-256 color", () => {
		const t256 = { ...truecolor, getColorMode: () => "256color" };
		const settings = { ...DEFAULT_SETTINGS, colors: { ...DEFAULT_SETTINGS.colors, error: "#ff0000" } };
		// #ff0000 is xterm-256 color 196.
		expect(load(t256, settings).draw("[[Failed]]")).toContain("\x1b[38;5;196m");
	});
	test("a 256-color terminal maps a gray hex color to the gray ramp, as pi does", () => {
		const t256 = { ...truecolor, getColorMode: () => "256color" };
		const settings = { ...DEFAULT_SETTINGS, colors: { ...DEFAULT_SETTINGS.colors, error: "#808080" } };
		// xterm-256 color 244 is the gray (128,128,128); the nearest cube color, 102, is (135,135,135).
		expect(load(t256, settings).draw("[[Failed]]")).toContain("\x1b[38;5;244m");
	});
});

describe("edges and icons", () => {
	test("round draws Powerline caps with no space inside", () => expect(draw("[[Done]]")).toMatch(/\ue0b6\x1b\[39m.*\x1b\[1m\u{f05e0}\u2002Done\x1b/u));
	test("half draws half blocks", () => {
		const out = draw("[[Done]]", { edges: "half" });
		expect(out).toContain("\u2590");
		expect(out).toContain("\u258c");
	});
	test("sharp pads the word with one filled space on each side", () => expect(draw("[[Done]]", { edges: "sharp" })).toContain("\x1b[1m\u00a0\u{f05e0}\u2002Done\u00a0\x1b"));
	test("outline icons", () => expect(draw("[[Done]]", { icons: "outline" })).toContain("\u{f05e1}\u2002Done"));
	test("no icons", () => expect(draw("[[Done]]", { icons: "none" })).toContain("\x1b[1mDone\x1b"));
	test("pills next to each other are two spaces apart", () => expect(draw("[[Done]] [[Failed]]")).toMatch(/\ue0b4\x1b\[39m  /));
});

describe("labels", () => {
	test("bold labels take the blue link color by default", () => expect(draw("**Cause:** x")).toContain(fgEsc("mdLink") + "\uf0e7\u2002Cause:"));
	test("a theme color name as label color", () => expect(draw("**Cause:** x", { labels: "mdListBullet" })).toContain(fgEsc("mdListBullet") + "\uf0e7\u2002Cause:"));
	test("a hex label color", () => expect(draw("**Cause:** x", { labels: "#010203" })).toContain("\x1b[38;2;1;2;3m\uf0e7\u2002Cause:"));
	test("a label after a kind-of-work pill takes its icon", () => expect(draw("[[Implement]] **Result:** yes")).toContain("\uf11e\u2002Result:"));
});

const REPLY = [
	"**Result:** the release is close.",
	"",
	"- **Build** [[Passed]] 212 of 212.",
	"- **Changelog** [[Done]] written.",
	"- **Docs** [[In progress]] 3 of 5.",
	"- **Key** [[Needs you]] unlock it.",
	"- **Version** [[Decision]] 2.0 or 1.9?",
].join("\n");

describe("count line", () => {
	test("one pill per word with its count, asks first, then wrong, open and settled", () =>
		expect(countLine(REPLY)).toBe("[[Needs you 1]] [[Decision 1]] [[In progress 1]] [[Passed 1]] [[Done 1]]"));
	test("it goes after the last block, as its own paragraph, and the lines above it stay as streamed", () => {
		const lines = draw(REPLY).split("\n");
		const streamed = draw(REPLY + "\n\nz", {}, true).split("\n").slice(0, -2);
		expect(lines.slice(0, -2)).toEqual(streamed);
		expect(lines.at(-2)).toBe("");
		expect(lines.at(-1)).toContain("Needs\u00a0you\u00a01");
	});
	test("no count line while the reply streams", () => expect(draw(REPLY, {}, true)).not.toContain("you\u00a01"));
	test("no count line under 5 state pills", () => expect(countLine(REPLY.split("\n").slice(0, 6).join("\n"))).toBeUndefined());
	test("no count line when every state pill has the same word", () => expect(countLine("x\n\n" + "- a [[Done]]\n".repeat(6))).toBeUndefined());
	test("no count line when the reply already has a line of only pills", () => expect(countLine("[[Done 4]] [[Failed 1]]\n\n" + REPLY)).toBeUndefined());
	test("a line holding one pill alone is no scoreboard", () => expect(countLine("[[Done]]\n\n" + REPLY)).toBeDefined());
	test("pills in code and headings do not count", () => {
		const md = "x\n\n- a [[Done]] \`[[Failed]]\`\n- b [[Done]]\n## [[Failed]]\n\`\`\`\n[[Failed]]\n[[Failed]]\n\`\`\`\n- c [[Partial]]";
		expect(countLine(md)).toBeUndefined();
	});
	test("detail and synonyms count as their word", () =>
		expect(countLine("x\n\n- [[Passed 12/12]]\n- [[Pass]]\n- [[Completed]]\n- [[Done]]\n- [[Fail: 3]]")).toBe("[[Failed 1]] [[Passed 2]] [[Done 2]]"));
	test("kinds of work, consequences and ownership do not count", () =>
		expect(countLine("x\n\n- [[Implement]]\n- [[Costs money]]\n- [[Shared]]\n- [[Done]]\n- [[Failed]]")).toBeUndefined());
});

describe("review fixes", () => {
	test("a heading escapes a $ before a digit too", () => expect(draw("## Costs $5 a month")).toContain("Costs \\$5"));
	test("a reply that ends with a list takes the count line after the list", () => {
		const md = ["- **Build** [[Passed]] ok", "", "- **Docs** [[Done]] ok", "", "- **Key** [[Needs you]] x", "", "- **V** [[Decision]] y", "", "- **Site** [[Partial]] z"].join("\n");
		const lines = draw(md).split("\n");
		expect(lines[0]).toContain("Build");
		expect(lines.at(-2)).toBe("");
		expect(lines.at(-1)).toContain("Needs\u00a0you\u00a01");
	});
	test("a reply that ends inside an open fence keeps the count line at its place near the top (a line at the end would be code)", () => {
		const md = ["- **Build** [[Passed]] ok", "", "- **Docs** [[Done]] ok", "", "- **Key** [[Needs you]] x", "", "- **V** [[Decision]] y", "", "- **Site** [[Partial]] z", "", "```", "code"].join("\n");
		expect(countPlace(readMarkdown(md.split("\n")))).toBe(0);
		const lines = draw(md).split("\n");
		expect(lines[0]).toContain("Needs\u00a0you\u00a01");
		expect(lines[1]).toBe("");
		expect(lines.at(-1)).toBe("code");
	});
	test("an unknown theme color name in the settings falls back to the default", () => {
		const strict = { ...truecolor, getFgAnsi: (name: never) => { if (!RGB[name]) throw new Error("Unknown theme color: " + name); return fgEsc(name); } };
		const settings = { ...DEFAULT_SETTINGS, labels: "teal", colors: { ...DEFAULT_SETTINGS.colors, success: "teal" } };
		const out = load(strict, settings).draw("**Cause:** [[Done]]");
		expect(out).toContain(fgEsc("mdLink") + "\uf0e7\u2002Cause:");
		expect(out).toContain("\x1b[38;2;195;232;141m");
	});
});

describe("currency", () => {
	test("a $ before a digit is escaped for pi's Markdown", () => expect(draw("saves $20 a month. **Undo:** none")).toContain("saves \\$20 a month."));
	test("an escaped $, a $ before a letter, and $ in code stay as written", () => {
		expect(draw("a \\$20 b")).toContain("a \\$20 b");
		expect(draw("a $HOME b")).toContain("a $HOME b");
		expect(draw("a \`$20\` b")).toContain("\`$20\`");
	});
});

describe("readSettings", () => {
	test("no block gives the defaults", () => expect(readSettings(undefined)).toEqual(DEFAULT_SETTINGS));
	test("valid values are kept and invalid ones fall back", () => {
		const s = readSettings({ edges: "half", icons: "bogus", labels: "#zzzzzz", colors: { ask: "#ff966c", error: 3 }, fill: { success: "text", ask: "glow" } });
		expect(s.edges).toBe("half");
		expect(s.icons).toBe("filled");
		expect(s.labels).toBe("mdLink");
		expect(s.colors.ask).toBe("#ff966c");
		expect(s.colors.error).toBe("error");
		expect(s.fill.success).toBe("text");
		expect(s.fill.ask).toBe("solid");
	});
});

describe("faint theme colors", () => {
	// Pi's theme.colors gives a faint (dim) token an approximation mixed toward the
	// background, while the token's escape keeps the original color plus SGR 2. Pills use the original color.
	test("a faint RGB tone color draws its panel from the original color, as without faint", () => {
		// Every pi token set (a Theme needs them all), then the colors the pills read.
		const values = { ...Object.fromEntries(Object.keys(THEME_TOKENS).map((t) => [t, "#808080"])), success: "#00ff00", error: "#000080", text: "#e0e0e0",
			toolPendingBg: "#202020", toolSuccessBg: "#202020", toolErrorBg: "#202020", selectedBg: "#202020", searchMatchBg: "#202020" };
		const faint = new PiTheme(values as never, {} as never, "truecolor", { dim: ["success", "text"] });
		// 0.22 * (0,255,0) + 0.78 * (32,32,32), rounded: (25,81,25); the word in the original (0,255,0).
		expect(load(faint).draw("[[Done]]")).toContain("\x1b[48;2;25;81;25m\x1b[38;2;0;255;0m\x1b[1m");
		// Solid on navy (0,0,128): WCAG contrast of the original text (224,224,224) is about 12.1, of (32,32,32)
		// about 1.02, so the ink is the original text color.
		expect(load(faint).draw("[[Destructive]]")).toContain("\x1b[48;2;0;0;128m\x1b[38;2;224;224;224m\x1b[1m");
	});
});

describe("theme switch", () => {
	// Pi keeps one theme object and swaps what it holds when /settings selects another theme.
	test("after a theme change the next draw uses the new theme's pill colors", () => {
		const other: Theme = {
			...truecolor,
			getFgAnsi: (name: never) => (name === "success" ? "\x1b[38;2;1;200;3m" : fgEsc(name)),
			colors: { ...truecolor.colors, success: rgbColor(1, 200, 3) },
		};
		let current = truecolor;
		const proxy = new Proxy({}, { get: (_, key) => (current as unknown as Record<string | symbol, unknown>)[key] }) as Theme;
		const switched = load(proxy);
		// The reference: a fresh load with each theme.
		expect(switched.draw("[[Done]]")).toBe(load(truecolor).draw("[[Done]]"));
		current = other;
		expect(switched.draw("[[Done]]")).toBe(load(other).draw("[[Done]]"));
		expect(switched.draw("[[Done]]")).toContain("\x1b[38;2;1;200;3m");
	});
	test("new colors inside the same theme object rebuild the pill colors", () => {
		// What a pi Theme does when its colors change: it hands out a new frozen colors object.
		const theme: Theme = { ...truecolor };
		const ext = load(theme);
		expect(ext.draw("[[Done]]")).toContain("\x1b[38;2;195;232;141m");
		theme.getFgAnsi = (name: never) => (name === "success" ? "\x1b[38;2;1;200;3m" : fgEsc(name));
		theme.colors = Object.freeze({ ...truecolor.colors, success: rgbColor(1, 200, 3) });
		const out = ext.draw("[[Done]]");
		expect(out).toContain("\x1b[38;2;1;200;3m");
		expect(out).not.toContain("\x1b[38;2;195;232;141m");
	});
});

describe("literal text", () => {
	test("inline code in a heading reaches pi unchanged", () => expect(draw("## Price key: \`$5\`")).toBe("## Price key: \`$5\`"));
	test("valid math such as $2^3$ reaches pi unchanged", () => expect(draw("Value $2^3$ here")).toBe("Value $2^3$ here"));
	test("a currency sign next to math is still escaped", () => expect(draw("costs $5 and $2^3$")).toContain("costs \\$5 and"));
});
