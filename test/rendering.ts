// Reads a terminal rendering back as visible text, style per character, OSC 8 link targets and bold color facts
// (test/bold.test.ts, test/host.test.ts).
const OSC8 = /\x1b\]8;[^;\x07\x1b]*;([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const PILL_DRAWN = /\x1b\[1m([^\x1b]*)\x1b\[22;27m\x1b\[39m\x1b\[49m/g;
const PILL_WRITTEN = /\[\[([^\[\]\n\x1b]{1,32})\]\]/g;
const PRIVATE_USE = /[\ue000-\uf8ff\u{f0000}-\u{ffffd}]\u2002?/gu;
export interface Reading {
	text: string;
	style: string;
	targets: string[];
	/** Characters in the bold color that pi does not draw bold. */
	falseColor: string;
	/** Characters pi draws bold that lack the bold color. */
	uncolored: string;
}
/** Reads a rendering: visible text, style per character (b, i, s), OSC 8 targets and color facts. */
export function read(lines: string[], boldFg: string): Reading {
	let out = lines.map((l) => l.trimEnd()).join("\n");
	const targets = [...out.matchAll(OSC8)].map((m) => m[1]).filter((t) => t !== "");
	out = out.replace(OSC, "").replace(PILL_DRAWN, (_, w: string) => "\u0005" + w.replace(PRIVATE_USE, "").replace(/\u00a0/g, " ") + "\u0005").replace(PILL_WRITTEN, "\u0005$1\u0005").replace(PRIVATE_USE, "");
	let bold = false, italic = false, strike = false, fg = "", pill = false;
	let text = "", style = "", falseColor = "", uncolored = "";
	for (let i = 0; i < out.length; i++) {
		if (out[i] === "\x1b" && out[i + 1] === "[") {
			const end = out.slice(i).search(/[@-~](?<=\x1b\[[0-9;?]*[@-~])/);
			const seq = out.slice(i, i + end + 1);
			i += end;
			if (!seq.endsWith("m")) continue;
			const ps = seq.slice(2, -1).split(";");
			for (let k = 0; k < ps.length; k++) {
				const p = ps[k];
				if (p === "" || p === "0") (bold = italic = strike = false), (fg = "");
				else if (p === "1") bold = true;
				else if (p === "22") bold = false;
				else if (p === "3") italic = true;
				else if (p === "23") italic = false;
				else if (p === "9") strike = true;
				else if (p === "29") strike = false;
				else if (p === "39") fg = "";
				else if (p === "38") {
					const n = ps[k + 1] === "2" ? 4 : 2;
					fg = "\x1b[" + ps.slice(k, k + 1 + n).join(";") + "m";
					k += n;
				} else if (p === "48") k += ps[k + 1] === "2" ? 4 : 2;
			}
			continue;
		}
		const c = out[i];
		if (c === "\u0005") {
			pill = !pill;
			text += c;
			style += "p";
			continue;
		}
		text += c;
		style += pill || c === "\n" ? "." : (bold ? "b" : "-") + (italic ? "i" : "") + (strike ? "s" : "") + ",";
		if (pill || !c.trim()) continue;
		if (fg === boldFg && !bold) falseColor += c;
		if (bold && fg !== boldFg) uncolored += c;
	}
	// Pill gaps: drawn pills next to each other are two spaces apart.
	const gap = /\u0005 +\u0005/g;
	return { text: text.replace(gap, "\u0005 \u0005"), style: style.replace(/p,+p/g, "pp"), targets, falseColor, uncolored };
}

// Regression inputs for bold drawing, one per bug class.
export const REVIEW = [
	"The powers are 2 ** 3 ** 4.",
	"2 ** 3 and **bold** here",
	"___important___",
	"a __ b __ c",
	"**first\nsecond** after",
	"x ~~~a **left~~ middle**right** end",
	"x ~~~a **foo~~ yes**",
	"文__「引用」__です",
	"**bold**](url)",
	"- **bold**](url)",
	"> **bold**](url)",
	"**https://example.org**",
	"**www.example.org**",
	"**ftp://example.org/x**",
	"**see https://example.org** then prose",
	"**a\nwww.example.org** end",
	"**see https://example.org\nmore** end",
	"**mail x@y.org\nmore** end",
	"**start `code`_italic_ tail**",
	"**start `code`__deep__ tail**",
	"**a <https://example.org>_x_ b**",
	"**a `multi\nline`_x_ b**",
	"**a <!-- hidden --> b**",
	"| left | right |\n|---|---|\n| **one | two** |",
	"<div>**word**</div>",
	"> <div>**word**</div>",
	"- <div>**word**</div>",
	"Calculate $x^2 then **foo**",
	"**before [[Done**]] after",
	"[[Done **before]] after** tail",
	"**go to https://example.org/a**today tail",
	"__Do:** literal__",
];


