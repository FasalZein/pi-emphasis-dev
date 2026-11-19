// Differential for links: generated replies with autolinks, inline links, reference links (defined, undefined,
// escaped, split over lines, long labels, defined in nested lists, sibling containers or inside a fence), bare
// URLs and emails next to CJK punctuation and overlapping each other, and links after HTML; blocks are joined
// apart (blank line) or within one paragraph (line break); "_", "__", "**" and pills sit in targets, titles and
// labels. Reference: pi's rendering of the raw reply (pi-tui's Markdown, test/oracle.ts), through
// test/links-oracle.ts.
// Per reply: (1) links: the ordered (target, caption) spans and the printed text (drawn pills written back,
// count line removed) equal pi's. (2) pills: a marked pill is drawn only where pi shows it as prose, and the count
// line counts exactly the drawn ones. (3) a pill pi shows that is not drawn is over-protection: the design
// allows it where the reader cannot prove a link's bounds; it is counted and printed per class.
// (4) cache: replaced-suffix sequences on one registration equal a fresh drawing.
import { expect, test } from "bun:test";
import { drawnCount, drawnIds, linkSpans, markedIds, shownText } from "./links-oracle.ts";
import { piShown } from "./oracle.ts";
import { countLineOf, load } from "./seam.ts";
import { truecolor } from "./truecolor.ts";

const ext = load(truecolor);

// A small seeded generator (mulberry32), so a failure reproduces.
let seed = 0x5eed;
const rand = () => {
	seed = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
// Each pill carries a unique id, so pi's reading of each one is checked alone.
let ids = 0;
const pill = () => "[[Done p" + ids++ + "q]]";

const part = () => pick(["a__b", "a__b__c", "a**b**c", pill(), "_x_", "a_" + pill() + "_b", "x", "**y**", "x(y(z))"]);
const text = () => pick(["doc", "d**o**c", "x " + pill(), "a__b__c", "see _it_", "t https://x.test/a"]);
const LABEL = ["r", "a__b", "a**b**c", "a\\]**b**", "label name", "Ref_1", "label > **b**"];
const CJK = ["，", "。", "：", "！", "）", "、", "；", "…"];
const WS = [" ", "\t", "  ", "\t "];
const prose = () => pick(["Status " + pill() + " here.", "Some **bold** text.", "Plain words."]);
/** label split over lines as a definition may write it: escapes, quote markers, blank lines, long runs. */
const splitLabel = (l: string) => {
	const words = l.split(" ");
	if (words.length < 2) return pick(["\n" + l, l + "\\\n", l]);
	return words.join(pick(["\n", "\n> ", "\n\n", "\n".repeat(9), " "]));
};

type Make = () => string;
const CLASSES: Record<string, Make> = {
	autolink: () => pick(["", "See "]) + "<https://x.test/" + part() + ">" + pick(["", " " + pill(), " **b**"]),
	"autolink email": () => "<m" + pick(["", "_x", ".y"]) + "@x.test>" + pick(["", " " + pill()]),
	inline: () => "See [" + text() + "](/" + part() + pick(["", ' "' + part() + '"']) + ") " + prose(),
	"inline two-line": () => "[" + text() + "](" + pick(["/" + part(), "\n" + pick(WS) + "<abc/" + part() + ">"]) + "\n" + pick(WS) + '"title ' + part() + '")',
	"reference defined": () => {
		const l = pick(LABEL);
		return "See [" + text() + "][" + l + "] " + prose() + "\n\n[" + l + "]: /" + part() + pick(["", ' "' + part() + '"']);
	},
	"reference undefined": () => "See [" + text() + "][" + pick(LABEL) + "] " + prose(),
	"reference escaped": () => {
		const l = "a\\]" + pick([" ", ""]) + part();
		return "See [doc][" + l + "]\n\n[" + l.replace(" ", pick(["\n", " "])) + "]: /" + part();
	},
	"reference split": () => {
		const l = pick(LABEL);
		return "See [" + text() + "][" + pick([l, l.replace(" ", "\n")]) + "]\n\n" + pick(["", "> ", "- "]) + "[" + splitLabel(l) + "]: /" + part() + pick(["", ' "' + part() + '"']);
	},
	"reference long label": () => "See [" + text() + "][a b]\n\n[a" + "\n".repeat(7 + Math.floor(rand() * 5)) + "b]: /" + part(),
	"reference nested-list": () => {
		const l = pick(LABEL);
		return "See [" + text() + "][" + l + "]\n\n" + pick(["- - ", "> - ", "1. - ", "- > ", "-"]) + "[" + l + "]: /" + part();
	},
	"reference in fence": () => {
		const l = pick(LABEL);
		return "Status [" + text() + "][" + l + "] " + pill() + "\n\n" + pick(["~~~", "\x60\x60\x60", "<span>\n>\n~~~"]) + "\n[" + l + "]: /unused\n" + pick(["~~~", "\x60\x60\x60"]);
	},
	"possible reference after URL": () => "See [text https://x.test/a][r]" + pill() + "\n\n" + pick(["    [r]: /unused", "[r]:", "-[r]: /unused", "[ r]: /ok", "prose\n[r]: /ok", "[r]: /ok"]),
	"bare URL CJK": () => "See " + pick(["https://x.test/", "www.x.test/", "http://x.test/", "www.x@a.test/"]) + part() + pick(CJK) + pick(["状态" + pill(), pill(), "**b**", ""]),
	"email CJK": () => "Mail a" + pick(["", "_b", ".c"]) + "@x.test" + pick(CJK) + pick([pill(), "**b**", ""]),
	"URL email overlap": () => "See " + pick(["www.x@a.test/p/", "https://a@b.test/", "a.www.x@b.test/", "x@www.a.test/"]) + part() + pick(["", "，" + pill(), " " + pill()]),
	"link after HTML": () =>
		pick(["<pre>\ntext\n</pre>\n", "<b>ok</b> ", "<!X d>\n", "<div>\n", "<span>\n\n", "<?p ?>\n", "<pre>\n</style>\n", "<pre>\n</pre>\n<span>\n", "text\n<?proc?> ", "text\n  <div> ", "<div\u00a0x> "]) +
		"[" + text() + "](/" + part() + ")" + pick(["", " " + pill()]),
	"sibling containers": () => pick(["- <div>\n- ", "> <div>\n> ", "1. <pre>\n2. ", "- x\n- "]) + "[" + text() + "](/" + part() + ")" + pick(["", " " + pill()]),
};
// Classes that are built to make links (the others may make none).
const LINKING = ["autolink", "autolink email", "inline", "inline two-line", "reference defined", "reference escaped", "reference split", "reference long label", "reference nested-list", "possible reference after URL", "bare URL CJK", "email CJK", "URL email overlap", "link after HTML", "sibling containers"];
const FOUR = "Text [[Done]] [[Failed]] [[Passed]] [[Blocked]].\n\n";
const doneCount = (md: string) => {
	const line = countLineOf(ext, FOUR + md);
	const m = line?.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, "").match(/Done[\u00a0 ](\d+)/);
	return m ? Number(m[1]) - 1 : 0;
};

test("links of generated replies stay pi's links; pills are drawn only where pi shows them and counted as drawn", () => {
	const made: Record<string, number> = {};
	const linked: Record<string, number> = {};
	const overProtected: Record<string, number> = {};
	const failures: string[] = [];
	let replies = 0;
	let withinParagraph = 0;
	let pills = 0;
	let drawnPills = 0;
	for (let n = 0; n < 3000; n++) {
		const names = Object.keys(CLASSES);
		const parts: string[] = [];
		const used: string[] = [];
		for (let k = 1 + Math.floor(rand() * 3); k > 0; k--) {
			const name = pick(names);
			used.push(name);
			parts.push(CLASSES[name]());
		}
		const join = rand() < 0.3 ? "\n" : "\n\n";
		if (join === "\n" && parts.length > 1) withinParagraph++;
		const md = parts.join(join);
		replies++;
		const spans = linkSpans(md);
		for (const name of used) {
			made[name] = (made[name] ?? 0) + 1;
			if (spans.length > 0) linked[name] = (linked[name] ?? 0) + 1;
		}
		const drawn = ext.draw(md);
		const line = countLineOf(ext, md);
		const body = line === undefined ? drawn : drawn.replace("\n\n" + line, "");
		const marked = markedIds(md);
		const shown = piShown(md, marked.map((id) => "[[Done " + id + "]]"));
		const isDrawn = drawnIds(ext, md);
		pills += marked.length;
		drawnPills += isDrawn.filter(Boolean).length;
		const hiddenDrawn = isDrawn.some((d, k) => d && !shown[k]);
		// Each drawn occurrence is counted (an id may occur twice, as in a label and its definition).
		const miscounted = doneCount(md) !== drawnCount(ext, md);
		if (JSON.stringify(linkSpans(drawn)) !== JSON.stringify(spans) || shownText(body) !== shownText(md) || hiddenDrawn || miscounted) failures.push(md);
		if (isDrawn.some((d, k) => !d && shown[k])) for (const name of used) overProtected[name] = (overProtected[name] ?? 0) + 1;
	}
	console.log("replies", replies, "; joined within one paragraph", withinParagraph, "; marked pills", pills, "; drawn", drawnPills);
	console.log("made per class", JSON.stringify(made));
	console.log("replies with pi links per class", JSON.stringify(linked));
	console.log("replies with an over-protected pill, per class", JSON.stringify(overProtected));
	console.log("failures", failures.length, JSON.stringify(failures.slice(0, 5)));
	for (const name of Object.keys(CLASSES)) expect(made[name] ?? 0).toBeGreaterThan(0);
	for (const name of LINKING) expect(linked[name] ?? 0).toBeGreaterThan(0);
	expect(drawnPills).toBeGreaterThan(0);
	expect(failures).toEqual([]);
}, 300_000);

test("replaced-suffix sequences on one registration draw as a fresh registration", () => {
	let sequences = 0;
	const failures: string[] = [];
	const names = Object.keys(CLASSES);
	for (let n = 0; n < 1500; n++) {
		const prefix = CLASSES[pick(names)]() + "\n\n";
		const first = pick([CLASSES[pick(names)](), "- - [r]: /ok", "[label\nname]: /x", "[a b]: /x", "[r]: /ok"]);
		const second = pick([CLASSES[pick(names)](), "plain", prose()]);
		const reused = load(truecolor);
		const a = prefix + first;
		for (let at = prefix.length; at <= a.length; at += 1 + Math.floor(rand() * 4)) reused.draw(a.slice(0, at), true);
		reused.draw(a);
		const b = prefix + second;
		for (let at = prefix.length; at <= b.length; at += 1 + Math.floor(rand() * 4)) {
			const p = b.slice(0, at);
			if (reused.draw(p, true) !== load(truecolor).draw(p, true)) failures.push(JSON.stringify([a, p]));
		}
		if (reused.draw(b) !== load(truecolor).draw(b)) failures.push(JSON.stringify([a, b]));
		sequences++;
	}
	console.log("replaced-suffix sequences", sequences, "; failures", failures.length, failures.slice(0, 3).join(" | "));
	expect(failures).toEqual([]);
}, 300_000);
