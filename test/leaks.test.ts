// Rendering leaks: every escape the extension adds closes what it opened, so the word after a pill, cap, glyph or
// connector keeps the terminal attributes pi gives it without the extension. The rows come from pi's own
// assistant-message component (pi applies quote, table-header and bold styles around the transformed text), with a
// real system theme for a terminal that reported no colors and pi's bundled dark theme in 256 colors. The oracle is
// pi alone: the attributes of the same word in pi's rendering of the same reply without the extension, with the
// foreground of the configured bold color (the theme's mdLink token) where pi draws the word bold inside a bold span.
import { describe, expect, test } from "bun:test";
import { load } from "./seam.ts";

const { default: chalk } = await import("../node_modules/chalk/source/index.js");
chalk.level = 3;
const PI = "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/";
const { AssistantMessageComponent } = await import(PI + "components/assistant-message.js");
const { Theme, loadThemeFromPath, setThemeInstance } = await import(PI + "theme/theme.js");
const { generateSystemThemeColors } = await import(PI + "theme/system-theme.js");
const DARK = new URL("../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/dark.json", import.meta.url).pathname;

/** pi's system theme when the terminal reported no colors (createSystemTheme in pi's theme.js). */
const systemTheme = (mode: string) => {
	const generated = generateSystemThemeColors({ saturation: 1, appearanceHint: "dark" });
	return new Theme(generated.colors, {}, mode, { name: "system", appearance: generated.appearance, dim: generated.dim });
};
const THEMES: [string, () => unknown][] = [
	["system theme, no reported colors, truecolor", () => systemTheme("truecolor")],
	["system theme, no reported colors, 256color", () => systemTheme("256color")],
	["dark theme, 256color", () => loadThemeFromPath(DARK, "256color")],
];

interface Attributes { bold: boolean; faint: boolean; italic: boolean; underline: boolean; reverse: boolean; strike: boolean; fg: string; bg: string }
const RESET: Attributes = { bold: false, faint: false, italic: false, underline: false, reverse: false, strike: false, fg: "", bg: "" };

/** The terminal attributes of the character at visible index `at` of a rendered row (the row starts from a reset). */
function attributesAt(row: string, at: number): Attributes | undefined {
	const s = { ...RESET };
	let visible = 0;
	for (let i = 0; i < row.length; i++) {
		if (row[i] === "\x1b") {
			if (row[i + 1] === "]") {
				const end = row.slice(i).search(/\x07|\x1b\\/);
				i += end + (row[i + end] === "\x07" ? 0 : 1);
				continue;
			}
			const m = /^\x1b\[([0-9;:]*)([@-~])/.exec(row.slice(i));
			if (!m) continue;
			i += m[0].length - 1;
			if (m[2] !== "m") continue;
			const ps = m[1] === "" ? ["0"] : m[1].split(";");
			for (let k = 0; k < ps.length; k++) {
				const p = ps[k];
				if (p === "0") Object.assign(s, RESET);
				else if (p === "1") s.bold = true;
				else if (p === "2") s.faint = true;
				else if (p === "22") s.bold = s.faint = false;
				else if (p === "3") s.italic = true;
				else if (p === "23") s.italic = false;
				else if (p === "4") s.underline = true;
				else if (p === "24") s.underline = false;
				else if (p === "7") s.reverse = true;
				else if (p === "27") s.reverse = false;
				else if (p === "9") s.strike = true;
				else if (p === "29") s.strike = false;
				else if (p === "39") s.fg = "";
				else if (p === "49") s.bg = "";
				else if (p === "38" || p === "48") {
					const n = ps[k + 1] === "2" ? 4 : 2;
					const value = ps.slice(k, k + 1 + n).join(";");
					if (p === "38") s.fg = value;
					else s.bg = value;
					k += n;
				} else if (/^(3[0-7]|9[0-7])$/.test(p)) s.fg = p;
				else if (/^(4[0-7]|10[0-7])$/.test(p)) s.bg = p;
			}
			continue;
		}
		const cp = row.codePointAt(i)!;
		if (cp > 0xffff) i++;
		if (visible === at) return s;
		visible++;
	}
	return undefined;
}
const visibleText = (row: string) => row.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-9;:]*[@-~]/g, "");

/** The attributes of the first character of the last occurrence of `word` in the rendering. */
function wordAttributes(rows: string[], word: string): Attributes {
	for (let r = rows.length - 1; r >= 0; r--) {
		const text = visibleText(rows[r]);
		const at = text.lastIndexOf(word);
		if (at < 0) continue;
		// Visible index in code points: the row text may hold astral icons.
		return attributesAt(rows[r], [...text.slice(0, at)].length)!;
	}
	throw new Error("no " + JSON.stringify(word) + " in " + JSON.stringify(rows));
}

const render = (theme: unknown, md: string, emphasis?: unknown, width = 100) => {
	setThemeInstance(theme);
	const ext = load(theme, emphasis);
	const transformer = (text: string, context: { messageType: string; isStreaming?: boolean }) => ext.draw(text, context.isStreaming === true, context.messageType);
	const host = (transformers: unknown[]) =>
		new AssistantMessageComponent({ role: "assistant", content: [{ type: "text", text: md }] }, false, undefined, "Thinking...", 1, transformers).render(width) as string[];
	return { plain: host([]), drawn: host([transformer]) };
};
/** The foreground a theme escape sets, in the form attributesAt reports. */
const foregroundOf = (escape: string) => attributesAt(escape + "x", 0)!.fg;

/** The word after the decoration keeps pi's attributes; the decoration is drawn. `bold`: the word is in a bold span. */
const CASES: { name: string; md: string; word: string; bold?: boolean; emphasis?: unknown }[] = [
	{ name: "faint solid cap, round edges", md: "[[Needs you]] tail", word: "tail", emphasis: { colors: { ask: "dim" } } },
	{ name: "faint solid cap, half edges", md: "[[Needs you]] tail", word: "tail", emphasis: { edges: "half", colors: { ask: "dim" } } },
	{ name: "faint solid cap inside bold", md: "**a [[Needs you]] b c**", word: "b c", bold: true, emphasis: { colors: { ask: "dim" } } },
	{ name: "tree connector inside bold", md: "**a ├── b c**", word: "b c", bold: true },
	{ name: "check glyph in a quote", md: "> before ✓ tail", word: "tail" },
	{ name: "arrow and cross in a quote list", md: "> - before → x ✗ tail", word: "tail" },
	{ name: "pill in a quote", md: "> before [[Done]] tail", word: "tail" },
	{ name: "faint cap in a quote", md: "> before [[Needs you]] tail", word: "tail", emphasis: { colors: { ask: "dim" } } },
	{ name: "glyph in bold in a quote", md: "> **a ├── b c** d", word: "b c", bold: true },
];

describe("the word after a decoration keeps pi's attributes (pi-tui rendered rows)", () => {
	for (const [themeName, make] of THEMES) {
		for (const c of CASES) {
			test(themeName + ": " + c.name + ": " + JSON.stringify(c.md), () => {
				const theme = make() as { getFgAnsi(name: string): string };
				const { plain, drawn } = render(theme, c.md, c.emphasis);
				expect(drawn).not.toEqual(plain);
				const expected = wordAttributes(plain, c.word);
				if (c.bold) {
					expect(expected.bold).toBe(true);
					expected.fg = foregroundOf(theme.getFgAnsi("mdLink"));
				}
				expect(wordAttributes(drawn, c.word)).toEqual(expected);
			});
		}
	}
});

// Rows that are no table header for pi, or a header pi prints raw because the pane is narrow: the word after the pill
// is not bold in pi alone, and the drawing must not make it bold.
const NOT_HEADER: { name: string; md: string; widths: number[] }[] = [
	{ name: "a quoted delimiter-like line after a paragraph", md: "[[Done]] Q | y\n> --- | ---", widths: [100, 24] },
	{ name: "separate list items", md: "- [[Done]] Q | y\n- --- | ---", widths: [100, 24] },
	{ name: "a table body row before a delimiter-like body row", md: "| a | b |\n|---|---|\n| [[Done]] Q | y |\n| --- | --- |", widths: [100, 24] },
	{ name: "a six-column header in a narrow pane (pi prints the table raw)", md: "| [[Done]] Q | b | c | d | e | f |\n|---|---|---|---|---|---|\n| 1 | 2 | 3 | 4 | 5 | 6 |", widths: [24] },
];
describe("the word after a pill keeps pi's attributes where pi draws no table-header bold", () => {
	for (const [themeName, make] of THEMES) {
		for (const c of NOT_HEADER) {
			for (const width of c.widths) {
				test(themeName + ", width " + width + ": " + c.name + ": " + JSON.stringify(c.md), () => {
					const { plain, drawn } = render(make(), c.md, undefined, width);
					expect(drawn).not.toEqual(plain);
					expect(wordAttributes(drawn, "Q")).toEqual(wordAttributes(plain, "Q"));
				});
			}
		}
	}
	test("a pill in a table body row and a paragraph after a table draw as before", () => {
		const theme = THEMES[2][1]();
		for (const [md, word] of [["| a | b |\n|---|---|\n| [[Done]] c | d |", "c"], ["| a | b |\n\n[[Done]] tail", "tail"]]) {
			const { plain, drawn } = render(theme, md);
			expect(wordAttributes(drawn, word)).toEqual(wordAttributes(plain, word));
		}
	});
});

describe("prompt sections of other extensions", () => {
	test.each(["print", "json", "rpc"])("%s mode leaves another extension's reply_style section as it was", (mode) => {
		const theme = THEMES[2][1]();
		expect(load(theme, undefined, mode).sections({ reply_style: "other extension" })).toEqual({ reply_style: "other extension" });
	});
});
