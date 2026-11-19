// Differential for links: generated replies with autolinks, inline links, reference links (defined, undefined,
// escaped, split over lines, defined in nested lists or inside a fence), bare URLs and emails next to CJK
// punctuation, and links after HTML, with "_", "__", "**" and "[[...]]" in targets, titles and labels.
// Reference: pi's own rendering of the raw reply (pi-tui's Markdown, test/oracle.ts). For each reply the
// decorated reply has pi's link targets and, outside drawn pills, pi's visible text.
import { expect, test } from "bun:test";
import { piLinks, piRender } from "./oracle.ts";
import { load } from "./seam.ts";
import { truecolor } from "./truecolor.ts";

const ext = load(truecolor);
const CONTROL = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[ -\/]*[@-~]/g;
// A drawn pill (edges, icon, label) and a written one: both leave the comparison; so does white space.
const DRAWN_PILL = /[\ue0b4\ue0b6\u2590\u258c]?(?:[\ue000-\uf8ff]|[\u{f0000}-\u{ffffd}])\u2002Done[\ue0b4\ue0b6\u2590\u258c]?/gu;
const shown = (md: string) => piRender(md).replace(CONTROL, "").replace(DRAWN_PILL, "").replaceAll("[[Done]]", "").replace(/\s/g, "");

// A small seeded generator (mulberry32), so a failure reproduces.
let seed = 0x5eed;
const rand = () => {
	seed = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];

const PART = ["a__b", "a__b__c", "a**b**c", "[[Done]]", "_x_", "a_[[Done]]_b", "x", "**y**"];
const TEXT = ["doc", "d**o**c", "x [[Done]]", "a__b__c", "see _it_"];
const LABEL = ["r", "a__b", "a**b**c", "a\\]**b**", "label name", "Ref_1"];
const CJK = ["，", "。", "：", "！", "）", "、", "；", "…"];
const WS = [" ", "\t", "  ", "\t "];
const PROSE = ["Status [[Done]] here.", "Some **bold** text.", "Plain words."];

type Make = () => string;
const CLASSES: Record<string, Make> = {
	autolink: () => pick(["", "See "]) + "<https://x.test/" + pick(PART) + ">" + pick(["", " [[Done]]", " **b**"]),
	"autolink email": () => "<m" + pick(["", "_x", ".y"]) + "@x.test>" + pick(["", " [[Done]]"]),
	inline: () => "See [" + pick(TEXT) + "](/" + pick(PART) + pick(["", ' "' + pick(PART) + '"']) + ") " + pick(PROSE),
	"inline two-line": () => "[" + pick(TEXT) + "](/" + pick(PART) + "\n" + pick(WS) + '"title ' + pick(PART) + '")',
	"reference defined": () => {
		const l = pick(LABEL);
		return "See [" + pick(TEXT) + "][" + l + "] " + pick(PROSE) + "\n\n[" + l + "]: /" + pick(PART) + pick(["", ' "' + pick(PART) + '"']);
	},
	"reference undefined": () => "See [" + pick(TEXT) + "][" + pick(LABEL) + "] " + pick(PROSE),
	"reference escaped": () => {
		const l = "a\\]" + pick(PART);
		return "See [doc][" + l + "]\n\n[" + l + "]: /" + pick(PART);
	},
	"reference split": () =>
		"See [" + pick(TEXT) + "][" + pick(["label name", "label > name"]) + "]\n\n" + pick(["", "> ", "- "]) + "[label\n" + pick(["", "\n"]) + pick(["", "> "]) + "name]: /" + pick(PART) + pick(["", ' "' + pick(PART) + '"']),
	"reference nested-list": () => {
		const l = pick(LABEL);
		return "See [" + pick(TEXT) + "][" + l + "]\n\n" + pick(["- - ", "> - ", "1. - ", "- > "]) + "[" + l + "]: /" + pick(PART);
	},
	"reference in fence": () => {
		const l = pick(LABEL);
		return "Status [" + pick(TEXT) + "][" + l + "] [[Done]]\n\n" + pick(["~~~", "\x60\x60\x60"]) + "\n[" + l + "]: /unused\n" + pick(["~~~", "\x60\x60\x60"]);
	},
	"bare URL CJK": () => "See " + pick(["https://x.test/", "www.x.test/", "http://x.test/"]) + pick(PART) + pick(CJK) + pick(["状态[[Done]]", "[[Done]]", "**b**", ""]),
	"email CJK": () => "Mail a" + pick(["", "_b", ".c"]) + "@x.test" + pick(CJK) + pick(["[[Done]]", "**b**", ""]),
	"bare URL in reference": () => "See [text https://x.test/" + pick(PART) + "][" + pick(LABEL) + "]" + pick(["", "[]"]) + pick(["", "\n\n[r]: /x"]),
	"link after HTML": () =>
		pick(["<pre>\ntext\n</pre>\n", "<b>ok</b> ", "<!X d>\n", "<div>\n", "<span>\n\n", "<?p ?>\n"]) + "[" + pick(TEXT) + "](/" + pick(PART) + ")" + pick(["", " [[Done]]"]),
};

test("links of generated replies stay pi's links; text outside drawn pills stays pi's", () => {
	const made: Record<string, number> = {};
	const linked: Record<string, number> = {};
	const failures: string[] = [];
	for (let n = 0; n < 4000; n++) {
		const names = Object.keys(CLASSES);
		const parts: string[] = [];
		for (let k = 1 + Math.floor(rand() * 3); k > 0; k--) {
			const name = pick(names);
			const block = CLASSES[name]();
			made[name] = (made[name] ?? 0) + 1;
			if (piLinks(block).length > 0) linked[name] = (linked[name] ?? 0) + 1;
			parts.push(block);
		}
		const md = parts.join("\n\n");
		const drawn = ext.draw(md);
		if (JSON.stringify(piLinks(drawn)) !== JSON.stringify(piLinks(md)) || shown(drawn) !== shown(md)) failures.push(md);
	}
	console.log("made per class", JSON.stringify(made));
	console.log("pi links per class", JSON.stringify(linked));
	console.log("failures", failures.length, JSON.stringify(failures.slice(0, 5)));
	for (const name of Object.keys(CLASSES)) expect(made[name] ?? 0).toBeGreaterThan(0);
	// Every class that pi links at all is realized with links ("reference undefined" and "reference in fence" make none).
	for (const name of Object.keys(CLASSES)) if (!["reference undefined", "reference in fence"].includes(name)) expect(linked[name] ?? 0).toBeGreaterThan(0);
	expect(failures).toEqual([]);
}, 120_000);
