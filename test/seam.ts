// The extension's seam for tests: the default export, loaded into a stand-in pi. The other seam is
// reader.ts (readMarkdown, countPlace), which tests import directly.
import type { Color } from "@earendil-works/pi-tui";
import register from "../index.ts";

/** The slice of pi's Theme the extension reads. */
export interface Theme {
	fg(color: never, text: string): string;
	getFgAnsi(color: never): string;
	getBgAnsi(color: never): string;
	getColorMode(): string;
	/** Concrete colors per token; pi hands out a new object when the theme's colors change. */
	colors: Readonly<Record<string, Color>>;
}
type Handler = (event: unknown, ctx?: unknown) => void;
type Transformer = (markdown: string, context: { messageType: string; isStreaming?: boolean }) => string;
type PromptEvent = { systemPromptOptions: { sections: Record<string, string> } };
/** pi's default surfaces for a transformer registered without messageTypes (docs/extensions.md). */
const PI_DEFAULT_TYPES = ["user", "assistant", "assistant-thinking"];

export interface Loaded {
	/** What pi hands its Markdown renderer for a message of this type after the extension's transformer. */
	draw(markdown: string, streaming?: boolean, messageType?: string): string;
	/** The prompt sections after the extension's handler, starting from the sections earlier handlers set. */
	sections(start?: Record<string, string>): Record<string, string>;
}

/**
 * Loads the extension into a stand-in pi and starts a session in the given mode, with the theme and
 * pi's settings.json "emphasis" block (undefined: no block).
 */
export function load(theme: unknown, emphasis?: unknown, mode = "tui"): Loaded {
	const handlers: Record<string, Handler[]> = {};
	let transform: Transformer | undefined;
	let messageTypes: readonly string[] | undefined;
	register({
		on: (name: string, h: Handler) => (handlers[name] ??= []).push(h),
		registerMarkdownTransformer: (t: Transformer, options?: { messageTypes?: readonly string[] }) => {
			transform = t;
			messageTypes = options?.messageTypes;
		},
		getSettings: () => (emphasis === undefined ? {} : { emphasis }),
	} as never);
	for (const h of handlers.session_start ?? []) h({}, { mode, ui: { theme } });
	return {
		// pi runs a transformer only on the surfaces it registered for.
		draw: (markdown, streaming = false, messageType = "assistant") =>
			(messageTypes ?? PI_DEFAULT_TYPES).includes(messageType) ? transform!(markdown, { messageType, isStreaming: streaming }) : markdown,
		sections(start = {}) {
			const event: PromptEvent = { systemPromptOptions: { sections: { ...start } } };
			for (const h of handlers.before_agent_start ?? []) h(event);
			return event.systemPromptOptions.sections;
		},
	};
}

/**
 * The drawing of a reply without its count line: the streaming drawing (which waits with the count line) of the
 * reply followed by a finished paragraph, so no unfinished tail of the reply is held back, minus that paragraph.
 */
export function drawWithoutCount(ext: Loaded, markdown: string): string[] {
	return ext.draw(markdown + "\n\nz", true).split("\n").slice(0, -2);
}

/**
 * The count line as drawn into a finished reply: the line it holds that the drawing without the count line
 * lacks (at the end, after its blank line; or, in a reply that ends inside an open block, nearer the top).
 * Undefined when the finished reply has no extra lines.
 */
export function countLineOf(ext: Loaded, markdown: string): string | undefined {
	const out = ext.draw(markdown).split("\n");
	const without = drawWithoutCount(ext, markdown);
	if (out.length === without.length) return undefined;
	let i = 0;
	while (out[i] === without[i]) i++;
	return i === without.length ? out[i + 1] : out[i];
}

// A drawn pill's visible text sits between bold on and the bold/reverse reset (pill() in index.ts).
const PILL_TEXT = /\x1b\[1m([^\x1b]*)\x1b\[22;27m/g;
const ESCAPE = /\x1b\[[0-9;a-zA-Z-]*m/g;
const ICON = /^(?:[\ue000-\uf8ff]|[\u{f0000}-\u{ffffd}])\u2002/u;
const EDGES = /[\ue0b4\ue0b6\u2590\u258c\s]/g;
/**
 * The words and counts a drawn count line shows, written back as "[[Done 2]] [[Failed 1]]" for comparison
 * with expected text written in the test. The pill words are read, never rendered from the expectation, so a
 * wrong word or count in the drawing shows here. A line with anything besides pills comes back unchanged.
 */
export function countWords(line: string | undefined): string | undefined {
	if (line === undefined) return undefined;
	const words = [...line.matchAll(PILL_TEXT)].map((m) => "[[" + m[1].replace(ICON, "").replace(/\u00a0/g, " ").trim() + "]]");
	const rest = line.replace(PILL_TEXT, "").replace(ESCAPE, "").replace(EDGES, "");
	return words.length > 0 && rest === "" ? words.join(" ") : line;
}

const TONES = ["success", "error", "warning", "ask", "danger", "mode", "owner", "neutral"] as const;
// Each tone gets its own color name and fill "text", so a pill's opening escape names its tone.
const toneTheme = {
	fg: (_: string, text: string) => text,
	getFgAnsi: (name: string) => "\x1b[38;tone-" + name + "m",
	getBgAnsi: (name: string) => "\x1b[48;" + name + "m",
	getColorMode: () => "truecolor",
	colors: {},
};
const toneExt = load(toneTheme, {
	colors: Object.fromEntries(TONES.map((t) => [t, "is" + t])),
	fill: Object.fromEntries(TONES.map((t) => [t, "text"])),
});
/** The tone the extension draws a pill label in, read from the drawn pill's color. Throws when no pill color shows. */
export function toneOf(label: string): string {
	const drawn = toneExt.draw("x [[" + label + "]]");
	const tone = drawn.match(/\x1b\[38;tone-is(\w+)m\x1b\[1m/)?.[1];
	if (tone === undefined) throw new Error("no pill tone in the drawing of " + JSON.stringify(label) + ": " + JSON.stringify(drawn));
	return tone;
}
