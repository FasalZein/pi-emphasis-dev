import { describe, expect, test } from "bun:test";
import { indexedColor } from "@earendil-works/pi-tui";
import { load as loadExtension, toneOf } from "./seam.ts";

// The tested rules (the Copy section of DESIGN.md). Pi renders a
// section as "<name>\n" + content + "\n</name>" (dist/core/system-prompt.js).
const RULES = `<reply_style>
The terminal draws [[Word]] as a colored pill and gives a bold lead label an icon.
- Open with **Result:**.
- Long reply: open with [[Kind]] **Result:**, Kind one of Brainstorm, Investigate, Preview, Implement, Qualify; a ## heading per group; each bullet **Subject** [[Pill]] text.
- Pills: Done, Passed, Fixed, Observed, Recommended, Failed, Blocked, Partial, In progress, Unverified, At risk, Needs you, Decision, Destructive, Costs money, Shared.
- After a pill, the step that resolves it, led by a bold Do:, Check:, Next:, Unblock:, Left:, Guard:, Undo: or See:.
- Costs money and Destructive: once, before an action that waits for approval. Mention a cost only there, or when it passes the approved amount.
</reply_style>`;

// A theme with its own panel colors; every color name maps to a fixed escape.
const theme = {
	fg: (name: string, text: string) => `\x1b[38;5;${name.length}m${text}\x1b[39m`,
	getFgAnsi: (name: string) => `\x1b[38;5;${name.length}m`,
	getBgAnsi: (name: string) => `\x1b[48;5;${name.length + 100}m`,
	getColorMode: () => "truecolor",
	// The indexed color each name's background escape draws.
	colors: new Proxy({}, { get: (_, name) => indexedColor(String(name).length + 100) }),
};

// The real entry in a stand-in pi (test/seam.ts), with pi's settings.json content.
const load = (mode: string, settings: { emphasis?: unknown } = {}) => loadExtension(theme, settings.emphasis, mode);

const ICON = /(?:[\ue000-\uf8ff]|[\u{f0000}-\u{ffffd}])/u;

describe("reply_style prompt section", () => {
	test("terminal mode adds exactly the tested rules as the reply_style section", () => {
		const sections = load("tui").sections();
		expect(Object.keys(sections)).toEqual(["reply_style"]);
		expect(`<reply_style>\n${sections.reply_style}\n</reply_style>`).toBe(RULES);
	});

	test.each(["print", "json", "rpc"])("%s mode adds no prompt section and draws nothing", (mode) => {
		const ext = load(mode);
		expect(ext.sections()).toEqual({});
		expect(ext.draw("**Result:** [[Done]]")).toBe("**Result:** [[Done]]");
	});
});

test.each(["user", "assistant-thinking", "custom", "summary", "changelog"])("%s Markdown reaches pi unchanged", (type) => {
	expect(load("tui").draw("**Result:** [[Done]]", false, type)).toBe("**Result:** [[Done]]");
});

// The words the rules teach, read from the rules text itself.
const label = RULES.match(/Open with \*\*(\w+):\*\*/)![1];
const kinds = RULES.match(/Kind one of ([^;]+);/)![1].split(", ");
const pillWords = RULES.match(/- Pills: (.+)\.\n/)![1].split(", ");
const leadIns = [...RULES.match(/led by a bold (.+)\.\n/)![1].matchAll(/(\w+):/g)].map((m) => m[1]);
const consequences = RULES.match(/- (.+) and (\w+): once,/)!.slice(1);

describe("every word the rules teach is drawn", () => {
	test("the rules text names 1 label, 5 kinds, 16 pills and 8 lead-ins", () => {
		expect(label).toBe("Result");
		expect(kinds).toEqual(["Brainstorm", "Investigate", "Preview", "Implement", "Qualify"]);
		expect(pillWords.length).toBe(16);
		expect(leadIns).toEqual(["Do", "Check", "Next", "Unblock", "Left", "Guard", "Undo", "See"]);
	});

	test("the cost rule names two pill words of the list, both drawn as consequences", () => {
		expect(consequences).toEqual(["Costs money", "Destructive"]);
		for (const word of consequences) {
			expect(pillWords).toContain(word);
			expect(toneOf(word)).toBe("danger");
		}
	});

	test("the label gets an icon as a line's lead label, also after a kind-of-work pill", () => {
		const ext = load("tui");
		// No colon: with one, a lead-in word would get its icon from the lead-in table and hide a lost label entry.
		expect(ext.draw(`**${label}** text`)).toMatch(new RegExp(`^\\*\\*[\\s\\S]*${ICON.source}\u2002${label}[^:]*\\*\\*`, "u"));
		expect(ext.draw(`[[Implement]] **${label}:** text`)).toMatch(new RegExp(`${ICON.source}\u2002${label}:`, "u"));
	});

	test("every kind of work is a mode pill with an icon", () => {
		const ext = load("tui");
		for (const kind of kinds) {
			expect(toneOf(kind)).toBe("mode");
			expect(ext.draw(`x [[${kind}]]`)).toMatch(new RegExp(`${ICON.source}\u2002${kind}`, "u"));
		}
	});

	test("every pill word of the rules has a color tone and an icon", () => {
		const ext = load("tui");
		for (const word of pillWords) {
			expect(toneOf(word)).not.toBe("neutral");
			const out = ext.draw(`x [[${word}]]`);
			// The pill joins its icon and words with no-break spaces.
			expect(out).toMatch(new RegExp(`${ICON.source}\u2002${word.replace(/ /g, "\u00a0")}`, "u"));
		}
	});

	test("every lead-in word of the rules gets an icon inside a line", () => {
		const ext = load("tui");
		for (const word of leadIns) {
			const out = ext.draw(`x [[Blocked]] **${word}:** step`);
			expect(out).toMatch(new RegExp(`${ICON.source}\u2002${word}:`, "u"));
		}
	});
});

describe("the emphasis settings block reaches the drawing", () => {
	test("icons none draws pills without icons", () => {
		// The rounded caps are Private Use Area glyphs too; pill icons live in the supplementary area.
		expect(load("tui", { emphasis: { icons: "none" } }).draw("x [[Done]]")).not.toMatch(/[\u{f0000}-\u{ffffd}]/u);
	});
	test("edges sharp draws no rounded caps", () => {
		const out = load("tui", { emphasis: { edges: "sharp" } }).draw("x [[Done]]");
		expect(out).not.toMatch(/[\ue0b4\ue0b6]/);
		expect(out).toContain("\u00a0\u{f05e0}\u2002Done\u00a0");
	});
	test("no settings block draws rounded caps and filled icons", () => {
		const out = load("tui").draw("x [[Done]]");
		expect(out).toMatch(/\ue0b6/);
		expect(out).toContain("\u{f05e0}\u2002Done");
	});
});
