import { describe, expect, test } from "bun:test";
import register, { toneOf } from "../index.ts";

// The tested rules, rules-b2.txt of the reply-style evaluation (289 tokens). Pi renders a section as
// "<name>\n" + content + "\n</name>" (dist/core/system-prompt.js).
const RULES_B2 = `<reply_style>
The terminal draws [[Word]] as a colored pill and gives a bold lead label an icon.
- Label: open every reply, and each subject of a long reply, with a bold label: Result, Status, Cause, Fix, Risk, Next, Plan, Evidence, Decision.
- Pill: put one beside the subject whose state it names, with only these words: [[Done]] [[Passed]] [[Fixed]] [[Failed]] [[Blocked]] [[In progress]] [[Unverified]] [[Needs you]] [[Decision]] [[Destructive]] [[Costs money]].
- Action: follow every pill except Done, Passed and Fixed with the one step that resolves it, led by a bold Do:, Check:, Next:, Unblock: or Undo:.
- Keep pills out of code, paths and commands.
</reply_style>`;

// The two events the entry handles: before_agent_start (event) and session_start (ctx).
type PromptEvent = { systemPromptOptions: { sections: Record<string, string> } };
type SessionCtx = { mode: string; ui: { theme: typeof theme } };
type Handler = (event: PromptEvent | Record<string, never>, ctx?: SessionCtx) => void;
type Transformer = (markdown: string, context: { messageType: string }) => string;

// A theme with its own panel colors; every color name maps to a fixed escape.
const theme = {
	fg: (name: string, text: string) => `\x1b[38;5;${name.length}m${text}\x1b[39m`,
	getFgAnsi: (name: string) => `\x1b[38;5;${name.length}m`,
	getBgAnsi: (name: string) => `\x1b[48;5;${name.length + 100}m`,
};

// Stand-in pi API: records on() handlers and the markdown transformer of the real entry.
function load(mode: string) {
	const handlers: Record<string, Handler[]> = {};
	let transform: Transformer | undefined;
	register({
		on: (name: string, h: Handler) => (handlers[name] ??= []).push(h),
		registerMarkdownTransformer: (t: Transformer) => (transform = t),
	} as never);
	for (const h of handlers.session_start ?? []) h({}, { mode, ui: { theme } });
	return {
		sections() {
			const event: PromptEvent = { systemPromptOptions: { sections: {} } };
			for (const h of handlers.before_agent_start ?? []) h(event);
			return event.systemPromptOptions.sections;
		},
		draw: (markdown: string) => transform!(markdown, { messageType: "assistant" }),
	};
}

const ICON = /[\ue000-\uf8ff]/u;

describe("reply_style prompt section", () => {
	test("terminal mode adds exactly the tested rules as the reply_style section", () => {
		const sections = load("tui").sections();
		expect(Object.keys(sections)).toEqual(["reply_style"]);
		expect(`<reply_style>\n${sections.reply_style}\n</reply_style>`).toBe(RULES_B2);
	});

	test.each(["print", "json", "rpc"])("%s mode adds no prompt section and draws nothing", (mode) => {
		const ext = load(mode);
		expect(ext.sections()).toEqual({});
		expect(ext.draw("**Result:** [[Done]]")).toBe("**Result:** [[Done]]");
	});
});

// The words the rules teach, read from the rules text itself.
const labels = RULES_B2.match(/bold label: ([^.]+)\./)![1].split(", ");
const pillWords = [...RULES_B2.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]).filter((w) => w !== "Word");
const leadIns = [...RULES_B2.match(/led by a bold (.+)\./)![1].matchAll(/(\w+):/g)].map((m) => m[1]);

describe("every word the rules teach is drawn", () => {
	test("the rules text names 9 labels, 11 pills and 5 lead-ins", () => {
		expect(labels.length).toBe(9);
		expect(pillWords.length).toBe(11);
		expect(leadIns).toEqual(["Do", "Check", "Next", "Unblock", "Undo"]);
	});

	test("every label of the rules gets an icon as a line's lead label", () => {
		const ext = load("tui");
		for (const label of labels) {
			// No colon: with one, a lead-in word (Next) would get its icon from the lead-in table and hide a lost label entry.
			const out = ext.draw(`**${label}** text`);
			expect(out).toMatch(new RegExp(`^\\*\\*[\\s\\S]*${ICON.source} ${label}[^:]*\\*\\*`, "u"));
		}
	});

	test("every pill word of the rules has a color tone and an icon", () => {
		const ext = load("tui");
		for (const word of pillWords) {
			expect(toneOf(word)).not.toBe("neutral");
			const out = ext.draw(`x [[${word}]]`);
			// The pill joins its icon and words with no-break spaces.
			expect(out).toMatch(new RegExp(`${ICON.source}\u00a0${word.replace(/ /g, "\u00a0")}`, "u"));
		}
	});

	test("every lead-in word of the rules gets an icon inside a line", () => {
		const ext = load("tui");
		for (const word of leadIns) {
			const out = ext.draw(`x [[Blocked]] **${word}:** step`);
			expect(out).toMatch(new RegExp(`${ICON.source} ${word}:`, "u"));
		}
	});
});
