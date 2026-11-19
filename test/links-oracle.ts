// Link and pill oracle for the link tests: pi's rendering of the raw reply against pi's rendering of the
// decorated reply. Shared by test/links.test.ts, test/links-review.test.ts and test/links-differential.test.ts.
import { expect } from "bun:test";
import { piRender, piShown } from "./oracle.ts";
import { countLineOf, type Loaded } from "./seam.ts";

const CONTROL = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[ -\/]*[@-~]/g;
const CSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]/g;
const OSC8 = /\x1b\]8;[^;\x07\x1b]*;([^\x07\x1b]*)(?:\x07|\x1b\\)/g;

/** The ordered link spans of pi's rendering of md: each OSC 8 target with the visible caption up to the link's end. */
export function linkSpans(md: string): [target: string, caption: string][] {
	const out = piRender(md);
	const spans: [string, string][] = [];
	let open: { target: string; from: number } | undefined;
	for (const m of out.matchAll(OSC8)) {
		if (m[1] !== "") open = { target: m[1], from: m.index + m[0].length };
		else if (open) {
			spans.push([open.target, out.slice(open.from, m.index).replace(CONTROL, "")]);
			open = undefined;
		}
	}
	if (open) spans.push([open.target, "<unclosed>"]);
	return spans;
}

// A drawn pill as the terminal shows it: an optional edge, the icon, an en space, the label (words joined with
// no-break spaces), an optional edge. It is written back as [[label]], the only visual change the drawing may make.
const DRAWN_PILL = /( *)[\ue0b4\ue0b6\u2590\u258c]?(?:[\ue000-\uf8ff]|[\u{f0000}-\u{ffffd}])\u2002([^\ue0b4\ue0b6\u2590\u258c\s]+(?:\u00a0[^\ue0b4\ue0b6\u2590\u258c\s]+)*)[\ue0b4\ue0b6\u2590\u258c]?( *)/gu;
/** What the terminal prints of pi's rendering of md, with each drawn pill written back as "[[label]]". */
export function shownText(md: string): string {
	// The space before and after a drawn pill may be doubled (the gap between pills): it counts as one.
	return piRender(md)
		.replace(CONTROL, "")
		.replace(DRAWN_PILL, (_, before: string, label: string, space: string) => (before ? " " : "") + "[[" + label.replace(/\u00a0/g, " ") + "]]" + (space ? " " : ""));
}
/** The marked pills ("[[Done p3q]]") of md. */
export const markedIds = (md: string) => [...new Set([...md.matchAll(/p\d+q/g)].map((m) => m[0]))];
/** Per marked id, whether the decorated reply shows it as a drawn pill. */
export function drawnIds(ext: Loaded, md: string): boolean[] {
	const shown = piRender(ext.draw(md)).replace(CONTROL, "");
	return markedIds(md).map((id) => new RegExp(String.raw`(?:[\ue000-\uf8ff]|[\u{f0000}-\u{ffffd}])\u2002Done\u00a0${id}`, "u").test(shown));
}
/** The number of drawn marked pills (each occurrence) in the decorated reply. */
export function drawnCount(ext: Loaded, md: string): number {
	return [...piRender(ext.draw(md)).replace(CONTROL, "").matchAll(/(?:[\ue000-\uf8ff]|[\u{f0000}-\u{ffffd}])\u2002Done\u00a0p\d+q/gu)].length;
}
/** The states the count line counts, each with its number, sorted, or [] when the reply has no count line. */
export function tallied(ext: Loaded, md: string): string[] {
	const line = countLineOf(ext, md);
	if (line === undefined) return [];
	return [...line.replace(CSI, "").matchAll(/\u2002([^\ue0b4\ue0b6\u2590\u258c]+?)[\u00a0 ](\d+)/gu)].map((m) => m[1].replace(/\u00a0/g, " ") + " " + m[2]).sort();
}

/**
 * The link property for one reply: pi's ordered (target, caption) spans are unchanged by the drawing, and the
 * text the terminal prints is pi's, except drawn pills (written back) and the count line.
 */
export function expectLinksKept(ext: Loaded, md: string) {
	expect(linkSpans(ext.draw(md))).toEqual(linkSpans(md));
	const line = countLineOf(ext, md);
	const drawn = line === undefined ? ext.draw(md) : ext.draw(md).replace("\n\n" + line, "");
	expect(shownText(drawn)).toBe(shownText(md));
}
/**
 * The pill property: each marked pill pi shows as prose is drawn, each other one is not; with four more counted
 * pills before it, the count line counts exactly the marked pills pi shows. md holds no other pill.
 */
const FOUR = "Text [[Done]] [[Failed]] [[Passed]] [[Blocked]].\n\n";
export function expectPillsAsPi(ext: Loaded, md: string) {
	const ids = markedIds(md);
	const shown = piShown(md, ids.map((id) => "[[Done " + id + "]]"));
	expect(drawnIds(ext, md)).toEqual(shown);
	// The count line counts states: the four plus each marked pill pi shows (all "Done"); none without one more.
	const n = shown.filter(Boolean).length;
	expect(tallied(ext, FOUR + md)).toEqual(n === 0 ? [] : ["Blocked 1", "Done " + (1 + n), "Failed 1", "Passed 1"]);
}
