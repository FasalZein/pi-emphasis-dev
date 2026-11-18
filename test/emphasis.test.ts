import { describe, expect, test } from "bun:test";
import { VOCABULARY } from "../index.ts";
import { load, toneOf } from "./seam.ts";

// A theme whose colors are readable tags, so tests can assert on what was colored.
const theme = {
	fg: (color: string, text: string) => `<${color}>${text}</>`,
	getFgAnsi: (color: string) => `\x1b[38;fg-${color}m`,
	getBgAnsi: (color: string) => `\x1b[48;bg-${color}m`,
	// Tags carry no color: pills take the path for themes without panel colors.
	getColorMode: () => "truecolor",
	colors: {},
};
const ext = load(theme);
const plain = (text: string) => ext.draw(text).replace(/\x1b\[[0-9;a-zA-Z-]*m/g, "").replace(/[\ue0b4\ue0b6]/g, "|").replace(/[\u00a0\u2002]/g, " ");

describe("pill tone", () => {
	test.each([
		["Failed", "error"], ["Blocked", "error"], ["Needs you", "ask"], ["Decision", "ask"], ["Unverified", "warning"],
		["Done", "success"], ["Observed", "success"], ["Costs money", "danger"], ["Irreversible", "danger"],
		["Implement", "mode"], ["Shared", "owner"], ["Inferred", "neutral"], ["Anything else", "neutral"],
	])("%s is %s", (word, tone) => expect(toneOf(word)).toBe(tone as never));

	test("case and spacing do not matter", () => expect(toneOf("  needs   YOU ")).toBe("ask"));
	test("a known word may carry detail", () => {
		expect(toneOf("Passed 12/12")).toBe("success");
		expect(toneOf("Failed: 3 tests")).toBe("error");
	});
	test("a longer word that starts like a known one is not that word", () => expect(toneOf("Donezo")).toBe("neutral"));
	test("every core word is colored as its tone", () => {
		for (const [tone, words] of Object.entries(VOCABULARY)) for (const word of words.core) expect(toneOf(word)).toBe(tone as never);
	});
});

describe("pills", () => {
	test("a known word gets its icon", () => expect(plain("[[Done]]")).toBe("|\u{f05e0} Done|"));
	test("an unknown word has no icon", () => expect(plain("[[Anything else]]")).toBe("|Anything else|"));
	test("synonyms display as one word and keep their detail", () => {
		expect(plain("[[Completed]]")).toBe("|\u{f05e0} Done|");
		expect(plain("[[Fail: 3 tests]]")).toBe("|\u{f0159} Failed: 3 tests|");
	});
	test("a label's own glyph wins over the table's", () => expect(plain("[[\uf0e7 Done]]")).toBe("|\uf0e7 Done|"));
	test("labels over 32 characters are left alone", () => {
		const long = `[[${"x".repeat(33)}]]`;
		expect(plain(long)).toBe(long);
	});
});

describe("labels", () => {
	test("a heading takes an icon from its word", () => expect(plain("## Finding")).toBe("## \uf002 Finding"));
	test("an unknown heading is untouched", () => expect(plain("## What happened")).toBe("## What happened"));
	test("a leading bold label takes an icon, after list markers and tree connectors", () => {
		expect(plain("**Cause:** x")).toBe("**<mdLink>\uf0e7 Cause:</>** x");
		expect(plain("- **Fix:** x")).toBe("- **<mdLink>\uf0ad Fix:</>** x");
		expect(plain("  ├── **Risk:** x")).toBe("  <dim>├──</> **<mdLink>\uf071 Risk:</>** x");
	});
	test("bold later in a line gets color but no icon", () => expect(plain("see **Cause** here")).toBe("see **<mdLink>Cause</>** here"));
});

describe("action lead-ins", () => {
	test("take an icon anywhere in a line when they end in a colon", () => {
		expect(plain("[[Unverified]] red pills. **Check:** run it")).toBe("|\u{f07c3} Unverified| red pills. **<mdLink>\uf046 Check:</>** run it");
		expect(plain("- **Unblock:** access")).toBe("- **<mdLink>\uf09c Unblock:</>** access");
	});
	test("get exactly one icon at the start of a line", () => expect(plain("**Next:** go")).toBe("**<mdLink>\uf061 Next:</>** go"));
	test("without a colon they are ordinary bold", () => expect(plain("please **do** it and **run** that")).toBe("please **<mdLink>do</>** it and **<mdLink>run</>** that"));
});

describe("what is left alone", () => {
	test("fenced code", () => {
		const block = "```\n**Cause:** → [[Done]]\n```";
		expect(plain(block)).toBe(block);
	});
	test("inline code", () => expect(plain("`[[Done]] → **x**`")).toBe("`[[Done]] → **x**`"));
	test("escaped asterisks", () => expect(plain("\\*\\*not bold\\*\\*")).toBe("\\*\\*not bold\\*\\*"));
});

test("arrows, checks and crosses take their colors", () => {
	expect(plain("a → b ✓ c ✗")).toBe("a <accent>→</> b <success>✓</> c <error>✗</>");
});
