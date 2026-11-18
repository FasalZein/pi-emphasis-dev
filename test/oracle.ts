// pi's own reading of a reply as the oracle for the block reader: the reply goes through pi-tui's Markdown
// (pi's configured parser: its tokenizer, CJK emphasis, LaTeX extensions, comment removal) with a theme
// that wraps code spans and code block lines in sentinels, and with math wrapped the same way.
import { Markdown, setCapabilityOverrides } from "@earendil-works/pi-tui";

// pi in a terminal with hyperlinks: a link shows its text only and carries its target in OSC 8.
setCapabilityOverrides({ hyperlinks: true });
// Terminal control sequences: OSC (such as an OSC 8 link target) and CSI.
const CONTROL = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[ -\/]*[@-~]/g;
const LINK_TARGET = /\x1b\]8;[^;\x07\x1b]*;([^\x07\x1b]+)(?:\x07|\x1b\\)/g;

const OPEN = "\u0001";
const CLOSE = "\u0002";
const mark = (t: string) => OPEN + t + CLOSE;
const plain = (t: string) => t;
const theme = { heading: plain, link: plain, linkUrl: plain, code: mark, codeBlock: mark, codeBlockBorder: plain, quote: plain, quoteBorder: plain, hr: plain, listBullet: plain, bold: plain, italic: plain, strikethrough: plain, underline: plain };

type Tok = { type: string; raw: string; pending?: boolean };
/** pi's Markdown with complete math shown as code: math renders as Unicode math, never as the written pill. */
// renderToken and renderInlineTokens are private in the declaration, public at run time.
type Renderer = { renderToken(t: Tok, w: number, n: unknown, s: unknown): string[]; renderInlineTokens(t: Tok[], s: unknown): string; render(w: number): string[] };
const Base = Markdown as unknown as new (text: string, px: number, py: number, theme: unknown) => Renderer;
class Oracle extends Base {
	renderToken(token: Tok, width: number, next: unknown, style: unknown): string[] {
		if (token.type === "latexBlock" && !token.pending) return [mark(token.raw)];
		return super.renderToken(token, width, next, style);
	}
	renderInlineTokens(tokens: Tok[], style: unknown): string {
		const mapped = tokens.map((t) => (t.type === "latex" && !t.pending ? { type: "codespan", raw: t.raw, text: t.raw } : t));
		return super.renderInlineTokens(mapped, style);
	}
}

/** The text pi shows for md, with code and math between OPEN and CLOSE. */
export function piRender(md: string): string {
	return new Oracle(md, 0, 0, theme).render(2000).map((l) => l.trimEnd()).join("\n");
}

/** For each id, true when pi shows it outside code and math (as prose), false when only in code or math or hidden. */
export function piShown(md: string, ids: string[]): boolean[] {
	// Only what the terminal prints is prose: a link target in OSC 8 is not.
	const out = piRender(md).replace(CONTROL, "");
	const outside: string[] = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i <= out.length; i++) {
		const c = out[i];
		if (i === out.length || c === OPEN || c === CLOSE) {
			if (depth === 0) outside.push(out.slice(start, i));
			if (c === OPEN) depth++;
			else if (c === CLOSE) depth = Math.max(0, depth - 1);
			start = i + 1;
		}
	}
	const prose = outside.join("\n");
	return ids.map((id) => prose.includes(id));
}

const span = (name: string) => (t: string) => "{" + name + "}" + t + "{/" + name + "}";
const styled = { ...theme, code: plain, codeBlock: plain, heading: span("H"), bold: span("B") };
/** pi's rendering with heading and bold spans marked {H}…{/H} and {B}…{/B}, terminal control sequences removed. */
export function piStyled(md: string): string {
	return new Markdown(md, 0, 0, styled).render(2000).map((l) => l.replace(CONTROL, "").trimEnd()).join("\n");
}

/** The link targets (OSC 8) of pi's rendering of md, in order. */
export function piLinks(md: string): string[] {
	return [...piRender(md).matchAll(LINK_TARGET)].map((m) => m[1]);
}
