// Host path: the review inputs through pi's own assistant-message component (pi-coding-agent's
// AssistantMessageComponent with its real Markdown transform hook, the bundled dark theme in truecolor, hyperlinks
// on), once without the extension and once with its transformer. The drawn rendering keeps pi's visible text, style
// per character and OSC 8 targets, and the bold color stays on bold text.
import { describe, expect, test } from "bun:test";
import { setCapabilityOverrides } from "@earendil-works/pi-tui";
import { REVIEW, read } from "./rendering.ts";
import { load } from "./seam.ts";

setCapabilityOverrides({ hyperlinks: true });
// pi's bold and italic come from chalk (the one pi's theme imports), which writes no escapes without a color
// terminal: set it to truecolor.
const { default: chalk } = await import("../node_modules/chalk/source/index.js");
chalk.level = 3;
const PI = "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/";
const { AssistantMessageComponent } = await import(PI + "components/assistant-message.js");
const { loadThemeFromPath, setThemeInstance } = await import(PI + "theme/theme.js");
const DARK = new URL("../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/dark.json", import.meta.url).pathname;
const theme = loadThemeFromPath(DARK, "truecolor");
setThemeInstance(theme);
const ext = load(theme);
const transformer = (md: string, context: { messageType: string; isStreaming?: boolean }) => ext.draw(md, context.isStreaming === true, context.messageType);
const host = (text: string, transformers: unknown[]) => {
	// The component reads only role and content of an assistant message.
	const message = { role: "assistant", content: [{ type: "text", text }] };
	return new AssistantMessageComponent(message, false, undefined, "Thinking...", 1, transformers).render(100) as string[];
};

describe("host path: pi's assistant-message component", () => {
	for (const md of REVIEW) {
		test(JSON.stringify(md), () => {
			const raw = read(host(md, []), theme.getFgAnsi("mdLink"));
			const drawn = read(host(md, [transformer]), theme.getFgAnsi("mdLink"));
			expect({ text: drawn.text, style: drawn.style, targets: drawn.targets }).toEqual({ text: raw.text, style: raw.style, targets: raw.targets });
			expect(drawn.falseColor).toBe("");
		});
	}
	test("the extension is active on this path: a plain bold span takes the bold color", () => {
		const drawn = read(host("Plain **bold words** here", [transformer]), theme.getFgAnsi("mdLink"));
		expect(drawn.style).toContain("b");
		expect(drawn.uncolored).toBe("");
	});
});
