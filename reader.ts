// The block reader: the lines of a reply in; per line a kind, the literal ranges and the plain flag out;
// plus the fallback place of the count line (countPlace).

// Which text of a reply is prose that may be drawn. The drawing and the count line share this one
// reading, so a pill is counted exactly when it is drawn. It follows CommonMark as pi's parser applies it,
// after pi's own tab replacement (three spaces). Where it cannot be sure, it reads code: that text is
// neither drawn nor counted.
export type Range = [start: number, end: number];
export interface ReadLine {
	kind: "prose" | "heading" | "code" | "blank";
	/** Ranges of a prose or heading line that stay literal: inline code and HTML comments. */
	literal: Range[];
	/** A line of a top-level paragraph or heading: no block quote, no list, indented 3 or fewer. */
	plain: boolean;
}

const QUOTE = /^ {0,3}> ?/;
const LIST_MARKER = /^([-*+]|\d{1,9}[.)])( +|$)/;
const FENCE_OPEN = /^(\x60{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^(\x60{3,}|~{3,}) *$/;
const HEADING = /^#{1,6}(?: |$)/;
const THEMATIC_BREAK = /^(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
/** THEMATIC_BREAK.test, skipping the regex for a line that cannot open with "*", "-" or "_". */
const thematicBreak = (s: string) => {
	const c = s[0];
	return (c === "*" || c === "-" || c === "_") && THEMATIC_BREAK.test(s);
};
// pi's display math block (pi-tui latexBlock): "$$" or "\[" opening a block, up to the first "$$" or "\]"
// that ends a line.
const MATH_MARKS = [
	{ open: /^\$\$[ \t]*/, close: /\$\$[ \t]*$/ },
	{ open: /^\\\[[ \t]*/, close: /\\\][ \t]*$/ },
];
const TABLE_DELIMITER = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
// A line that ends a paragraph for pi's parser: a list item interrupts only when not empty and, if ordered, at 1.
const PARAGRAPH_END = /^(?:\x60{3,}|~{3,}|#{1,6}(?: |$)|>|<|[-*+] +\S|1[.)] +\S)/;
// "\\", backtick, "$", "<", and the characters of inline constructs that pi's parser (marked) tokenizes
// before its LaTeX rule when they start earlier: "[", "]", "(", ")", "*", "_", "~", ">".
const SPECIAL_CODES = new Uint8Array(128);
for (const c of [0x5c, 0x60, 0x24, 0x3c, 0x5b, 0x5d, 0x28, 0x29, 0x2a, 0x5f, 0x7e, 0x3e]) SPECIAL_CODES[c] = 1;
const WORD_CHAR = /[\p{L}\p{N}]/u;
const SPACE = /\s/;
// A link title (marked's title rule); it may hold line breaks.
const LINK_TITLE = String.raw`(?:"(?:\\"?|[^"\\])*"|'(?:\\'?|[^'\\])*'|\((?:\\\)?|[^)\\])*\))`;
// A link reference definition (marked's def rule): pi shows nothing of it. Its destination and its title may
// each sit on the next line. Matched against the definition's lines joined with "\n".
const DEFINITION = new RegExp(String.raw`^\[(?!\s*\])((?:\\.|[^\[\]\\])+)\]: *(?:\n[ \t]*)?(?:[^<\s]\S*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)${LINK_TITLE})? *(?=\n|$)`);
// The label of a line that may define a link (looser than DEFINITION: used to know which labels pi can link).
const DEFINED_LABEL = /^ {0,3}(?:> ?)*\s*(?:(?:[-*+]|\d{1,9}[.)]) +)?\[((?:\\.|[^\[\]\\])+)\]:/;
const labelKey = (label: string) => label.trim().replace(/\s+/g, " ").toLowerCase();
// An inline link's destination and title from its "(" (marked's link rule), over lines joined with "\n".
const LINK_TARGET = new RegExp(String.raw`^\(\s*(?:<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f()]*(?:\([^ \t\n\x00-\x1f()]*\)[^ \t\n\x00-\x1f()]*)*)(?:(?:[ \t]+(?:\n[ \t]*)?|\n[ \t]*)${LINK_TITLE})?\s*\)`);
// A bare email address (marked's GFM url rule, email branch).
const EMAIL = /^[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![-_])/;
// An autolink (marked's autolink rule): its target is the link, never prose.
const AUTOLINK = /^<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s\x00-\x1f<>]*|[A-Za-z0-9.!#$%&'*+/=?^_\x60{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+)>/;

// A bare URL (marked's GFM url rule and its trailing-punctuation backpedal): pi links it as a whole.
const URL_START = /(?:[hH][tT][tT][pP][sS]?|[fF][tT][pP]):\/\/|www\.|[A-Za-z0-9._+-]+@/g;
const URL = /^(?:(?:[hH][tT][tT][pP][sS]?|[fF][tT][pP]):\/\/|www\.)(?:[a-zA-Z0-9-]+\.?)+[^\s<]*/;
const URL_BACKPEDAL = /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/;
/** The start of the next bare URL candidate at or after from, or -1. */
function urlStart(text: string, from: number): number {
	URL_START.lastIndex = from;
	return URL_START.exec(text)?.index ?? -1;
}
/** The end of the bare URL or email address at index at, or -1. */
function urlEnd(text: string, at: number): number {
	const rest = text.slice(at);
	const email = rest.match(EMAIL);
	if (email) return at + email[0].length;
	let url = rest.match(URL)?.[0];
	if (url === undefined) return -1;
	for (let previous = ""; previous !== url; ) {
		previous = url;
		url = URL_BACKPEDAL.exec(url)?.[0] ?? "";
	}
	return url ? at + url.length : -1;
}

/**
 * The end of the inline link destination and title that open with the "(" at index at, after the
 * closing "]" of link text, or -1 when none closes on this line (marked's inline link rule).
 */
function linkTargetEnd(text: string, at: number): number {
	let q = at + 1;
	while (text[q] === " " || text[q] === "\t") q++;
	if (text[q] === "<") {
		while (++q < text.length && text[q] !== ">" && text[q] !== "<") if (text[q] === "\\") q++;
		if (text[q] !== ">") return -1;
		q++;
	} else {
		let depth = 0;
		for (; q < text.length; q++) {
			const c = text[q];
			if (c === "\\") q++;
			else if (c === " " || c === "\t" || c < " ") break;
			else if (c === "(") depth++;
			else if (c === ")") {
				if (depth === 0) break;
				depth--;
			}
		}
		if (depth !== 0) return -1;
	}
	const afterDestination = q;
	while (text[q] === " " || text[q] === "\t") q++;
	const open = text[q];
	if ((open === '"' || open === "'" || open === "(") && q > afterDestination) {
		const close = open === "(" ? ")" : open;
		for (q++; q < text.length && text[q] !== close; q++) if (text[q] === "\\") q++;
		if (q >= text.length) return -1;
		q++;
		while (text[q] === " " || text[q] === "\t") q++;
	}
	return text[q] === ")" ? q + 1 : -1;
}

const LHEADING_STOP = /^(?:(?:[*+-]|\d{1,9}[.)]) |\x60{3,}|~{3,}|>|#{1,6}(?: |$)|<)/;
// A line that may end a paragraph and open another block: a code span reaching past it is uncertain.
const INTERRUPT = /^(?:\x60{3,}|~{3,}|#{1,6}(?: |$)|>|<|(?:[-*+]|\d{1,9}[.)])(?: |$))/;

/** A line as pi's parser sees its block: tabs as three spaces, block quote markers counted and removed. */
function blockOf(line: string): { depth: number; indent: number; body: string; lead: number } {
	// A line that opens with neither a space, a tab nor ">" has no indent and no quote marker.
	const first = line.charCodeAt(0);
	if (first !== 0x20 && first !== 0x09 && first !== 0x3e && !line.includes("\t")) return { depth: 0, indent: 0, body: line, lead: 0 };
	let rest = line.replace(/\t/g, "   ");
	const lead = rest.match(/^ */)![0].length;
	let depth = 0;
	for (let q = rest.match(QUOTE); q; q = rest.match(QUOTE)) {
		rest = rest.slice(q[0].length);
		depth++;
	}
	const indent = rest.match(/^ */)![0].length;
	return { depth, indent, body: rest.slice(indent), lead };
}

/** Sorted ranges with overlapping ones joined. */
function mergeRanges(ranges: Range[]): Range[] {
	let ordered = true;
	for (let i = 1; i < ranges.length && ordered; i++) ordered = ranges[i][0] > ranges[i - 1][1];
	// Already sorted with gaps between: the merge would leave them unchanged. (No caller changes a range
	// after the reading, so the ranges are returned as they are, not copied.)
	if (ordered) return ranges;
	const merged: Range[] = [];
	for (const [start, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
		const last = merged.at(-1);
		if (last && start <= last[1]) last[1] = Math.max(last[1], end);
		else merged.push([start, end]);
	}
	return merged;
}

/** The start of the first run of exactly n backticks at or after from, or -1. */
function backtickRun(text: string, from: number, n: number): number {
	for (let i = from; i < text.length; ) {
		if (text[i] !== "\x60") {
			i++;
			continue;
		}
		let j = i;
		while (text[j] === "\x60") j++;
		if (j - i === n) return i;
		i = j;
	}
	return -1;
}

/** A line that may define a link label: a reference link before it may read differently once it arrives. */
export const mayDefine = (line: string) => {
	// Only a line that opens with "[", a space, a tab, ">", a list marker or a digit can (checked first: cheap).
	const c = line.charCodeAt(0);
	if (!(c === 0x5b || c === 0x20 || c === 0x09 || c === 0x3e || c === 0x2d || c === 0x2a || c === 0x2b || (c >= 0x30 && c <= 0x39))) return false;
	return line.includes("]:") && DEFINED_LABEL.test(line);
};

export function readMarkdown(lines: string[]): ReadLine[] {
	return readBlocks(lines).read;
}

/**
 * The reading of readMarkdown plus the last finished-block boundary: the last blank line b after which the
 * reader's state equals its start state and whose lines 0..b were read without looking past line b. Then the
 * reading of lines 0..b does not depend on the lines after b, and the reading of the lines after b equals
 * the reading of those lines alone (with indexes shifted by b + 1). -1 when there is none.
 */
export function readBlocks(lines: string[]): { read: ReadLine[]; boundary: number; end: EndState } {
	const read: ReadLine[] = [];
	// The end marker of an open top-level HTML block of CommonMark types 1, 3, 4 and 5, which a blank line does
	// not close (type 2, a comment, is read as code below). The reading of its lines is unchanged; the state
	// only keeps finished-block boundaries out of it and tells the caller that the reply ends inside it.
	let htmlEnd: RegExp | undefined;
	// The line that closed the last HTML block of types 1, 3-5 of the open paragraph; -1 when an HTML line of
	// another type came after it. Lines after it are a new pi block: only the end state reads it.
	let htmlClosedAt = -1;
	// The open paragraph is an HTML block of type 6 (such as "<div>"), which ends at a blank line: an opener or
	// a math mark in it is HTML text.
	let htmlFlow = false;
	// The furthest line any lookahead has read so far; lines.length when a lookahead ran to the reply's end.
	let seen = 0;
	const see = (k: number) => {
		if (k > seen) seen = k;
	};
	let boundary = -1;
	let fence: { char: string; length: number; base: number; depth: number; line: number } | undefined;
	let indentedBase: number | undefined;
	let paragraph = false;
	// The first line of the open paragraph: a setext underline makes its lines a heading.
	let paragraphStart = 0;
	// The content column of the list item the open paragraph opened with, 0 when it opened with no list marker.
	let paragraphColumn = 0;
	// The open "paragraph" is the lazy tail of a quoted definition: pi holds no paragraph text there yet.
	let definitionParagraph = false;
	let emptyItem = false;
	let previousDepth = 0;
	// Display math opens no block after an unclosed math mark (pi then shows the rest as written) or inside a
	// paragraph that opens with "<" (pi may read it as an HTML block up to a blank line).
	let mathOff = false;
	// Set after a pending inline math opening, up to the paragraph's end.
	let pendingMath = false;
	// Math is read only at top level: in a quote or a list item pi's container rules decide, which the reader
	// does not follow; there it draws as before (a documented limit).
	let inContainer = false;
	// The last line that surely ended a top-level block (a fence's closing line, a thematic break).
	let blockEnd = -1;
	// Set when an earlier line of the paragraph left an inline construct open, or held a math opening that
	// such a construct may hold: the reader takes no more inline math in the paragraph.
	let inlineCarry = false;
	// The open paragraph began at top level (no quote, no list).
	let topParagraph = false;
	let htmlParagraph = false;
	// A code span or an HTML comment that may close on a later line: lines up to its end are literal, whichever way pi reads them.
	let literalUntil: { line: number; end: number; uncertain: boolean } | undefined;
	const untilNow = () => literalUntil;
	// Set while reading lines under an uncertain span the other way: spans found then are uncertain too.
	let discovering = false;
	const listColumns: number[] = [];
	const code: ReadLine = { kind: "code", literal: [], plain: false };

	// pi shows the text as written (pending math): it holds no link.
	// In a paragraph that opens with "<" pi may show an HTML block as written: link metadata is drawn as before.
	const asWritten = () => mathOff || pendingMath || containerMath || htmlParagraph;
	// Set at a math mark in a quote or a list item, where the reader does not follow pi's math: pi may show the
	// rest as written. Link metadata is then drawn as before. Cleared at the next top-level block after a blank line.
	let containerMath = false;
	// A line up to the last blank line may define a link label.
	let definitionSeen = false;
	let definitionChecked = 0;
	// The labels that a definition line may define (for reference links), read once per reading when needed.
	let defined: Set<string> | undefined;
	const isDefined = (label: string) => {
		// A label holds no unescaped bracket.
		if (label.includes("[") || label.includes("]")) return false;
		if (!defined) {
			defined = new Set();
			for (const line of lines) {
				const m = mayDefine(line) ? line.match(DEFINED_LABEL) : null;
				if (m) defined.add(labelKey(m[1]));
			}
		}
		return defined.has(labelKey(label));
	};
	/**
	 * The end of the inline link target at the "(" at index at of line i: [line, end] of its last character
	 * plus one, or undefined. Lines of the same paragraph after line i may hold the rest.
	 */
	const targetEnd = (i: number, at: number, multiline: boolean): [number, number] | undefined => {
		const text = lines[i];
		const end = linkTargetEnd(text, at);
		if (end > 0) return [i, end];
		if (!multiline) return undefined;
		// marked's rule over the paragraph's next lines (up to a blank line or a line that opens a block).
		let joined = text.slice(at);
		const starts: number[] = [];
		for (let k = i + 1; k < lines.length && k <= i + 8; k++) {
			const next = blockOf(lines[k]);
			if (!next.body.trim() || INTERRUPT.test(next.body) || next.depth !== blockOf(text).depth || lines[k].includes("\t")) break;
			see(k);
			starts.push(joined.length + 1);
			joined += "\n" + next.body;
		}
		if (starts.length === 0) return undefined;
		const m = joined.match(LINK_TARGET);
		if (!m || !m[0].includes("\n")) return undefined;
		let k = starts.length - 1;
		while (k >= 0 && starts[k] > m[0].length) k--;
		if (k < 0) return [i, at + m[0].length];
		const line = lines[i + 1 + k];
		return [i + 1 + k, line.length - blockOf(line).body.length + m[0].length - starts[k]];
	};
	// The literal ranges of line i from "from" on.
	const inline = (i: number, from: number, multiline: boolean): Range[] => {
		const text = lines[i];
		const literal: Range[] = from > 0 ? [[0, from]] : [];
		// pi's parser tries its LaTeX rule first at each position, but a link, emphasis, an HTML tag, a
		// strikethrough or a bare URL that starts earlier takes a "$" inside it out of reach. The reader does
		// not lex these; it tracks whether one may be open (brackets, link targets, delimiter runs, tags) and
		// takes no math from a "$" that one may hold, nor any later math in the paragraph.
		// Open "[" of link text: where it opens, whether it is an image ("!["), and whether it can no longer
		// form a link (marked's link text holds no other link).
		const opens: { at: number; image: boolean; dead: boolean; deep: boolean }[] = [];
		let target = 0;
		let stars = 0;
		let unders = 0;
		let tildes = 0;
		let tag = false;
		let unsure = inlineCarry;
		// Position p is inside a bare URL (pi's parser links it, "$" included, up to a space). The word start
		// moves only forward, so the check stays linear in the line.
		const hasUrl = text.includes("://") || text.includes("www.");
		let scanned = from;
		let wordStart = from;
		// The next bare URL start; outside link text, its URL is literal.
		let nextUrl = hasUrl || text.includes("@") ? urlStart(text, from) : -1;
		const inUrl = (p: number) => {
			if (!hasUrl) return false;
			for (; scanned < p; scanned++) if (SPACE.test(text[scanned])) wordStart = scanned + 1;
			const word = text.slice(wordStart, p);
			return word.includes("://") || word.startsWith("www.");
		};
		// The innermost open "[" closes into a link after index from (a bare URL there is no link for pi).
		const formsLink = (from: number): boolean => {
			const label = opens[opens.length - 1];
			for (let q = from, depth = 0; q < text.length; q++) {
				const ch = text[q];
				if (ch === "\\") q++;
				else if (ch === "[") depth++;
				else if (ch === "]" && depth > 0) depth--;
				else if (ch === "]") {
					if (label.dead) return false;
					if (text[q + 1] === "(") return linkTargetEnd(text, q + 1) > 0;
					return text[q + 1] === "[" || isDefined(text.slice(label.at + 1, q));
				}
			}
			return false;
		};
		for (let p = from; p < text.length; ) {
			// Jump to the next character that may open a code span, a comment, math, an escape or a construct.
			if (nextUrl >= 0 && nextUrl < p) nextUrl = urlStart(text, p);
			// (Codes of 128 and above are read before the table: an index past its end is a slow load in V8.)
			for (; p < text.length && p !== nextUrl; p++) {
				const unit = text.charCodeAt(p);
				if (unit < 128 && SPECIAL_CODES[unit] === 1) break;
			}
			if (p >= text.length) break;
			if (p === nextUrl) {
				// pi links no bare URL inside the text of a link.
				const end = !asWritten() && !(opens.length > 0 && formsLink(p)) ? urlEnd(text, p) : -1;
				if (end > p) literal.push([p, end]);
				// A failed email candidate is skipped up to its "@", so the search stays linear.
				p = end > p ? end : text.slice(p).match(/^[A-Za-z0-9._+-]*@/)?.[0].length ? p + text.slice(p).match(/^[A-Za-z0-9._+-]*@/)![0].length : p + 1;
				nextUrl = urlStart(text, p);
				continue;
			}
			const c = text[p];
			if (c === "[" || c === "]" || c === "(" || c === ")" || c === ">") {
				if (c === "[") {
					// marked's link text holds brackets one level deep: a "[" two levels in ("[a [[Done]]](/x)") leaves
					// the outer text no link.
					// Such text keeps the link's shape, and a pill drawn in it would make its escapes a link: it is left
					// as written too (owner decision 2026-11-18), but marks no link around it as dead.
					if (opens.length >= 2) opens[opens.length - 2].deep = true;
					opens.push({ at: p, image: text[p - 1] === "!" && !escapedAt(text, p - 1), dead: false, deep: false });
				}
				else if (c === "]") {
					// A link is drawn by pi as a whole: its text, destination and title stay literal (owner decision
					// 2026-11-18: a pill or bold in link text would break the link).
					const label = opens.pop();
					if (label && !label.dead && !asWritten()) {
						let end: [number, number] | undefined;
						if (text[p + 1] === "(") end = targetEnd(i, p + 1, multiline);
						else if (text[p + 1] === "[") {
							// A full reference link [text][ref] or a collapsed one [ref][].
							const close = text.indexOf("]", p + 2);
							const ref = close > 0 ? text.slice(p + 2, close) : undefined;
							if (ref !== undefined && !ref.includes("[") && isDefined(ref.trim() ? ref : text.slice(label.at + 1, p))) end = [i, close + 1];
						} else if (!(text[label.at - 1] === "[" && text[p + 1] === "]") && isDefined(text.slice(label.at + 1, p))) end = [i, p + 1];
						// (The inner label of a pill, "[[x]]", is not read as a shortcut reference: a documented limit.)
						if (end) {
							if (!label.image && !label.deep) for (const o of opens) o.dead = true;
							const start = label.image ? label.at - 1 : label.at;
							if (end[0] === i) {
								literal.push([start, end[1]]);
								p = end[1];
								continue;
							}
							// The target goes on over later lines: they are literal up to its end.
							literal.push([start, text.length]);
							const until = untilNow();
							if (!until || end[0] > until.line || (end[0] === until.line && end[1] > until.end)) literalUntil = { line: end[0], end: end[1], uncertain: false };
							break;
						}
					}
					if (text[p + 1] === "(") {
						target = 1;
						p++;
					}
				} else if (c === "(") {
					if (target > 0) target++;
				} else if (c === ")") {
					if (target > 0) target--;
				} else tag = false;
				p++;
				continue;
			}
			if (c === "*" || c === "_" || c === "~") {
				let q = p;
				while (text[q] === c) q++;
				const before = text[p - 1] ?? " ";
				const after = text[q] ?? " ";
				// A run between spaces opens and closes nothing; so does "_" inside a word.
				const inert = (SPACE.test(before) && SPACE.test(after)) || (c === "_" && WORD_CHAR.test(before) && WORD_CHAR.test(after));
				if (!inert) {
					if (c === "*") stars++;
					else if (c === "_") unders++;
					else tildes++;
				}
				p = q;
				continue;
			}
			if (c === "\\" || c === "$") {
				// Only pending math (no closing mark on the line) may make pi show the rest as written.
				if (inContainer && !containerMath && !htmlParagraph && (c === "$" || text[p + 1] === "(" || text[p + 1] === "[") && inlineMathEnd(text, p) === PENDING) containerMath = true;
				// pi shows inline math (pi-tui's latex extension) as math: its pills stay literal.
				let math = mathOff || pendingMath || htmlParagraph || inContainer || unsure ? -1 : inlineMathEnd(text, p);
				if (math !== -1 && (opens.length > 0 || target > 0 || stars % 2 || unders % 2 || tildes % 2 || tag || inUrl(p))) {
					unsure = true;
					math = -1;
				}
				if (math === PENDING) {
					// No closing mark on this line. With none up to the paragraph's end either, pi shows the rest of
					// the paragraph as written (pending math), with no more math in it. The search stops at the
					// first closing mark, and a paragraph turns pending at most once, so the reader stays linear.
					const close = text.startsWith("\\(", p) ? "\\)" : text.startsWith("\\[", p) ? "\\]" : text.startsWith("$$", p) ? "$$" : "$";
					let closed = false;
					let k = i + 1;
					// The paragraph ends at a blank line or a line that opens another block.
					// pi's math block also cuts the paragraph where it opens (closed, or pending with math in it).
					for (; k < lines.length && lines[k].trim() && !PARAGRAPH_END.test(lines[k].trimStart()) && !thematicBreak(lines[k].trim()) && !opensMathBlock(lines, k, see); k++) {
						if (lines[k].includes(close) && hasClosing(lines[k], close)) {
							closed = true;
							break;
						}
					}
					see(k);
					if (!closed && (close[0] !== "$" || PENDING_MATH.test([text.slice(p + close.length), ...lines.slice(i + 1, k)].join("\n")))) pendingMath = true;
				}
				if (math > 0) {
					literal.push([p, math]);
					p = math;
				} else p += text[p] === "$" ? 1 : 2;
				continue;
			}
			const comment = text[p] === "<";
			const autolink = comment && text[p + 1] !== "!" && !asWritten() ? text.slice(p).match(AUTOLINK) : null;
			if (autolink) {
				literal.push([p, p + autolink[0].length]);
				p += autolink[0].length;
				continue;
			}
			if (comment && !text.startsWith("<!--", p)) {
				// An HTML tag or an autolink may hold a "$" up to its ">".
				if (/[A-Za-z/!?]/.test(text[p + 1] ?? "")) tag = true;
				p++;
				continue;
			}
			let q = p;
			while (!comment && text[q] === "\x60") q++;
			const ender = comment ? "-->" : text.slice(p, q);
			const find = (s: string, from: number) => (comment ? s.indexOf("-->", from) : backtickRun(s, from, q - p));
			const close = find(text, comment ? p + 4 : q);
			if (close >= 0) {
				literal.push([p, close + ender.length]);
				p = close + ender.length;
				continue;
			}
			// An unclosed code span or comment may close on a later line of its paragraph, up to the next
			// blank line. Past a line that may open another block, pi may read that line without it.
			let found = false;
			const openDepth = blockOf(text).depth;
			let k = i + 1;
			for (let uncertain = discovering; multiline && k < lines.length && lines[k].trim(); k++) {
				// A quoted blank line ends the paragraph for CommonMark but not always for pi's parser.
				const { body, depth } = blockOf(lines[k]);
				uncertain ||= depth !== openDepth || !body.trim() || INTERRUPT.test(body);
				const c = find(lines[k], 0);
				if (c >= 0) {
					see(k);
					const until = untilNow();
					if (!until || k > until.line || (k === until.line && c + ender.length > until.end)) literalUntil = { line: k, end: c + ender.length, uncertain };
					found = true;
					break;
				}
			}
			if (found) {
				literal.push([p, text.length]);
				break;
			}
			if (multiline) see(k);
			if (comment) {
				// Never closed: pi's parser hides the rest of the paragraph, or shows "<!--" as text and reads
				// on. Nothing after it is drawn up to the paragraph's end.
				literal.push([p, text.length]);
				if (multiline && k - 1 > i) {
					const until = untilNow();
					if (!until || k - 1 > until.line) literalUntil = { line: k - 1, end: lines[k - 1].length, uncertain: true };
				}
				p += 4;
				continue;
			}
			p = q;
		}
		if (unsure || opens.length > 0 || target > 0 || stars % 2 || unders % 2 || tildes % 2 || tag) inlineCarry = true;
		return mergeRanges(literal);
	};
	/** The literal ranges of a prose or heading line, inside or after a code span from an earlier line. */
	const literalOf = (i: number, multiline: boolean): Range[] => {
		if (!literalUntil) return inline(i, 0, multiline);
		const { line, end, uncertain } = literalUntil;
		if (line > i) {
			// Read the line without the span too, to find spans that pi may open here instead.
			if (uncertain) {
				discovering = true;
				inline(i, 0, multiline);
				discovering = false;
			}
			return [[0, lines[i].length]];
		}
		literalUntil = undefined;
		const after = inline(i, end, multiline);
		if (!uncertain) return after;
		// Both readings: the line after the span, and the line on its own. Literal where either says so.
		discovering = true;
		const alone = inline(i, 0, multiline);
		discovering = false;
		return mergeRanges([...after, ...alone]);
	};
	const push = (line: ReadLine, i: number) => {
		if (line.kind !== "prose") {
			pendingMath = false;
			inlineCarry = false;
		}
		if (line.kind !== "prose" && line.kind !== "heading" && literalUntil?.line === i) literalUntil = undefined;
		read.push(line);
	};

	for (let i = 0; i < lines.length; i++) {
		// Fast path: a top-level fence (no quote, no list) ends only at a closing line, whose first character after
		// spaces and tabs is the fence character (no container can end it: see "left" below). Every other line is
		// code. Not taken in an open HTML block of types 1, 3-5, whose end marker each line is tested for below.
		if (fence && fence.depth === 0 && fence.base === 0 && htmlEnd === undefined) {
			const char = fence.char.charCodeAt(0);
			for (; i < lines.length; i++) {
				const text = lines[i];
				let q = 0;
				let c = text.charCodeAt(0);
				while (c === 0x20 || c === 0x09) c = text.charCodeAt(++q);
				if (c === char) break;
				push(code, i);
			}
			if (i === lines.length) break;
		}
		// Only the end marker of the opening line closes the block: an opener on a line inside it, or on its
		// closing line, starts nothing (CommonMark: one HTML block ends at the first line with its end marker).
		const inHtml = htmlEnd !== undefined || htmlFlow;
		if (htmlEnd && htmlEnd.test(lines[i])) {
			htmlEnd = undefined;
			htmlClosedAt = i;
		}
		const { depth, indent, body, lead } = blockOf(lines[i]);
		if (fence) {
			// A fence in a block quote or a list item ends with its container; the line is then read anew.
			// Leaving a block quote ends its fence. In a list item, pi's parser (marked) keeps a plain text line
			// that is indented less in the fence, so only a line that opens a block ends the item.
			const quoteOutside = depth > fence.depth && lead < fence.base;
			// marked ends the item also when the line before is the fence's opening line or indented 4 more.
			// (Computed only when needed: blockOf is pure.)
			const previous = () => i - 1 === fence!.line || blockOf(lines[i - 1]).indent - fence!.base >= 4;
			const left = depth < fence.depth || quoteOutside || (fence.base > 0 && body.trim() !== "" && indent < fence.base && (previous() || INTERRUPT.test(body)));
			if (!left) {
				const close = depth === fence.depth ? body.match(FENCE_CLOSE) : null;
				if (close && close[1][0] === fence.char && close[1].length >= fence.length && indent - fence.base <= 3) {
					fence = undefined;
					// A top-level fence's closing line ends its block for sure: the next line may open math.
					if (depth === 0 && listColumns.length === 0) blockEnd = i;
				}
				push(code, i);
				continue;
			}
			fence = undefined;
		}
		if (indentedBase !== undefined) {
			if (!body.trim() || indent >= indentedBase + 4) {
				push(code, i);
				continue;
			}
			indentedBase = undefined;
		}
		// Entering or leaving a block quote opens new containers, unless the line continues a paragraph lazily.
		// A line indented 4 or more opens no block in a paragraph: it continues it, also lazily. After a line that
		// may open an HTML block, pi may hold no paragraph there: the line is read as before.
		// thematicBreak(body), once per line.
		const breakLine = thematicBreak(body);
		const opensBlock = (indent <= 3 || !paragraph || htmlParagraph || definitionParagraph) && (INTERRUPT.test(body) || breakLine);
		const lazy = paragraph && depth < previousDepth && body.trim() !== "" && !opensBlock;
		if (depth !== previousDepth && !lazy) {
			paragraph = false;
			listColumns.length = 0;
		}
		if (!lazy) previousDepth = depth;
		// In an open HTML block only an empty line is blank: a lone ">" there is HTML text.
		if (!body.trim() && !(inHtml && lines[i].trim())) {
			// A list item that opens empty ends at a blank line.
			if (emptyItem) listColumns.pop();
			emptyItem = false;
			paragraph = false;
			htmlParagraph = false;
			htmlFlow = false;
			push({ kind: "blank", literal: [], plain: false }, i);
			const clean = !fence && indentedBase === undefined && !paragraph && !emptyItem && previousDepth === 0 && listColumns.length === 0;
			// A definition gives meaning to reference links before it, so no head holds one.
			// Lines are checked for a definition only up to a candidate boundary, each once.
			if (clean && !definitionSeen) for (; definitionChecked < i && !definitionSeen; definitionChecked++) definitionSeen = mayDefine(lines[definitionChecked]);
			if (clean && !definitionSeen && seen <= i && !containerMath && !mathOff && !pendingMath && !inlineCarry && !htmlParagraph && literalUntil === undefined && !discovering && !htmlEnd) boundary = i;
			continue;
		}
		// After a blank line, a line indented less than a list item's content ends that item.
		// Any other line indented less than an item's content, except a lazy paragraph line, ends it too.
		if (containerMath && depth === 0 && read[i - 1]?.kind === "blank" && (listColumns.length === 0 || indent < listColumns[0])) containerMath = false;
		const columns = listColumns.length;
		if (!paragraph || opensBlock || /^(?:=+|-+) *$/.test(body)) while (listColumns.length && listColumns[listColumns.length - 1] > indent) listColumns.pop();
		const base = listColumns.at(-1) ?? 0;
		if (!paragraph && indent >= base + 4) {
			indentedBase = base;
			push(code, i);
			continue;
		}
		// A setext underline ends its paragraph. A lazy line or one indented 4 or more past its container is no
		// underline for pi: it continues the paragraph.
		if (paragraph && !lazy && indent - base <= 3 && /^(?:=+|-+) *$/.test(body)) {
			paragraph = false;
			// pi shows the paragraph as a heading when the underline is in its container: not a lazy line, not one
			// that ends a list item, and indented 3 or fewer. Its place for the count line stays above it, as before.
			// After a line that may open an HTML block (htmlParagraph), pi may read the underline in that block.
			// A paragraph that opened in a list item takes an underline only inside that item.
			// marked's lheading rule also takes no title line after the first that is indented 4 or more or opens with
			// a list marker and a space, a fence, ">", "#" or "<".
			let title = listColumns.length === columns && !htmlParagraph && (paragraphColumn === 0 || indent >= paragraphColumn);
			for (let k = paragraphStart + 1; title && k < i; k++) {
				const line = blockOf(lines[k]);
				title = line.indent - line.lead < 4 && line.indent < 4 && !LHEADING_STOP.test(line.body);
			}
			if (title) for (let k = paragraphStart; k < i; k++) if (read[k].kind === "prose") read[k] = { kind: "heading", literal: read[k].literal, plain: false };
			push({ kind: "prose", literal: literalOf(i, false), plain: false }, i);
			continue;
		}
		if (breakLine && indent - base <= 3) {
			if (depth === 0 && listColumns.length === 0) blockEnd = i;
			paragraph = false;
			push(code, i);
			continue;
		}
		let content = body;
		let contentBase = Math.min(base, indent);
		let marker = false;
		// A list item opens on this line (not a marker that pi may read as paragraph text).
		let newItem = false;
		let itemCode = false;
		emptyItem = false;
		// List markers and, inside a list item, block quote markers, in any order. Four spaces after a quote
		// marker or five after a list marker open indented code.
		let innerDepth = 0;
		for (;;) {
			const m = (content === body ? breakLine : thematicBreak(content)) ? null : content.match(LIST_MARKER);
			// The first item of a list interrupts a paragraph only when it is not empty and, if ordered, starts
			// at 1; pi's parser does not always hold to this. Such a line is read both ways: as an item for
			// what it opens on this line, as paragraph text for the lines after it.
			const ambiguous = m !== null && !marker && paragraph && (!content.slice(m[0].length).trim() || (/^\d/.test(m[1]) && Number.parseInt(m[1], 10) !== 1));
			if (m) {
				if (!marker) while (listColumns.length && listColumns[listColumns.length - 1] > indent) listColumns.pop();
				const start = marker ? contentBase : indent;
				const spaces = m[2].length;
				contentBase = start + m[1].length + (spaces >= 1 && spaces <= 4 ? spaces : 1);
				if (!ambiguous) {
					listColumns.push(contentBase);
					newItem = true;
				}
				content = content.slice(m[0].length);
				marker = true;
				emptyItem = !content.trim();
				if (spaces >= 5 && content) {
					itemCode = true;
					break;
				}
				continue;
			}
			const q = content.match(QUOTE);
			if (!q) break;
			content = content.slice(q[0].length);
			innerDepth++;
			const lead = content.match(/^ */)![0].length;
			if (lead >= 4 && content.trim()) {
				itemCode = true;
				break;
			}
			content = content.slice(lead);
		}
		if (itemCode) {
			indentedBase = contentBase;
			paragraph = false;
			push(code, i);
			continue;
		}
		// pi shows a closed display math block as math, so its pills stay literal. An unclosed one pi shows as
		// written (or, without math in it, reads as a paragraph); the reader then reads on as usual.
		// A lazy line continues the paragraph before it (in a quote or a list item) and opens no block.
		// In an open HTML block (types 1, 3-6) a math mark is HTML text: it changes no state.
		const mathMark = !inHtml && (content[0] === "$" || content[0] === "\\") && MATH_MARKS.some((m) => m.open.test(content));
		// After a code line (which may be a lazy line pi reads as text) the reader takes no math block.
		const topLevel = () => depth + innerDepth === 0 && !marker && listColumns.length === 0 && (!paragraph || topParagraph) && (read[i - 1]?.kind !== "code" || blockEnd === i - 1);
		const mathEnd: number = mathMark && topLevel() && !mathOff && !htmlParagraph && !lazy && indent <= 3 ? mathBlockEnd(lines, i, content) : -1;
		if (mathMark) see(mathEnd >= 0 ? mathEnd : lines.length);
		// Pending math (no closing mark, an empty block or a table start): pi shows the rest of the reply as
		// written; for "$$" only when the rest looks like math.
		// A mark the reader does not take as a closed top-level block may be pending math for pi: the reader then
		// reads no more math in the reply and draws as before.
		// In a quote or a list item, pi lexes the container's content on its own: pending math there ends with
		// the container and leaves top-level math after it alone.
		if (mathMark && mathEnd < 0 && depth + innerDepth === 0 && !marker && listColumns.length === 0) mathOff = true;
		else if (mathMark && mathEnd < 0 && !containerMath) {
			// In a container: only a block that does not close may make pi show the rest as written.
			const end = mathBlockEnd(lines, i, content);
			see(end >= 0 ? end : lines.length);
			if (end < 0) containerMath = true;
		}
		if (mathEnd >= 0) {
			paragraph = false;
			for (; i <= mathEnd; i++) push(code, i);
			i--;
			continue;
		}
		const open = content.match(FENCE_OPEN);
		if (open && (marker || innerDepth > 0 || indent - base <= 3) && !(open[1][0] === "\x60" && open[2].includes("\x60"))) {
			fence = { char: open[1][0], length: open[1].length, base: innerDepth ? 0 : contentBase, depth: depth + innerDepth, line: i };
			paragraph = false;
			push(code, i);
			continue;
		}
		// An HTML comment that opens a line is an HTML block up to the whole line that ends it.
		if (content.startsWith("<!--")) {
			paragraph = false;
			push(code, i);
			if (!content.includes("-->", 4)) {
				for (i++; i < lines.length && !lines[i].includes("-->"); i++) push(code, i);
				if (i < lines.length) push(code, i);
			}
			i++;
			see(i);
			// pi's parser (marked) may keep the lines after the comment's end in the HTML block up to a blank
			// line or a line that opens another block.
			for (; i < lines.length && lines[i].trim() && !INTERRUPT.test(blockOf(lines[i]).body); i++) push(code, i);
			see(i);
			i--;
			continue;
		}
		// A link reference definition, outside a paragraph (a new list item or quote opens none): pi shows none
		// of it. Its destination and title may go on over the next lines of the same quote depth.
		if ((!paragraph || newItem || innerDepth > 0) && !lazy && !mathOff && !containerMath && !htmlParagraph && content[0] === "[" && content.includes("]:")) {
			let joined = content;
			let k = i + 1;
			for (; k < lines.length && k <= i + 8; k++) {
				const next = blockOf(lines[k]);
				if (!next.body.trim() || next.depth !== depth) break;
				joined += "\n" + next.body;
			}
			const m = joined.match(DEFINITION);
			if (m) {
				const last = i + (m[0].match(/\n/g)?.length ?? 0);
				see(Math.min(k, lines.length - 1));
				paragraph = false;
				for (; i <= last; i++) push(code, i);
				i--;
				// marked's block quote takes the lines after a quoted definition lazily, as after a paragraph.
				if (depth > 0) {
					paragraph = true;
					definitionParagraph = true;
					paragraphStart = i + 1;
					paragraphColumn = 0;
				}
				// A top-level definition ends its block for sure: the next line may open math.
				if (depth === 0 && listColumns.length === 0) blockEnd = i;
				continue;
			}
		}
		const plain = depth + innerDepth === 0 && !marker && listColumns.length === 0 && indent <= 3;
		if (!paragraph) topParagraph = plain;
		// marked looks for the next block from the paragraph's second character: "x $$" there opens pending
		// math, which pi shows as written up to the reply's end. The reader then reads no more math.
		if (!paragraph && /^. {0,3}(?:\$\$|\\\[)/.test(content)) mathOff = true;
		inContainer = depth + innerDepth > 0 || marker || listColumns.length > 0 || lazy || !topParagraph;
		if (!marker && HEADING.test(content) && indent - base <= 3) {
			paragraph = false;
			// A heading is a block of its own: pending math and open constructs of the paragraph before end here.
			pendingMath = false;
			inlineCarry = false;
			push({ kind: "heading", literal: literalOf(i, false), plain }, i);
			continue;
		}
		// An empty list item holds no paragraph yet.
		// An HTML block (such as "<div>") may also interrupt a paragraph.
		if (content.startsWith("<")) {
			htmlParagraph = true;
			const kind = plain && !lazy && !inHtml ? HTML_UNTIL.find(([opens]) => opens.test(content)) : undefined;
			if (kind && !kind[1].test(content.slice(2))) htmlEnd = kind[1];
			else if (kind) htmlClosedAt = i;
			else if (!inHtml) {
				htmlClosedAt = -1;
				htmlFlow = plain && !lazy && HTML_FLOW.test(content);
			}
		}
		if (!paragraph) {
			pendingMath = false;
			inlineCarry = false;
		}
		definitionParagraph = false;
		if (!paragraph || marker) {
			paragraphStart = i;
			paragraphColumn = marker ? contentBase : 0;
		}
		paragraph = !emptyItem;
		const paragraphPlain = plain && !/^[<|]/.test(body);
		push({ kind: "prose", literal: literalOf(i, true), plain: paragraphPlain }, i);
	}
	// The reply ends where pi's parser keeps the next line in the same block: an open top-level HTML block of
	// types 1, 3-5, or display math that pi shows as math or as written up to the reply's end.
	const open = htmlEnd !== undefined || mathOff;
	// After the closing line of an HTML block of types 1, 3-5 pi starts a new block: the text there is not HTML.
	const htmlText = htmlParagraph && !(htmlClosedAt >= 0 && htmlClosedAt < lines.length - 1);
	return { read, boundary, end: { open, literal: open || htmlText || pendingMath || containerMath || literalUntil !== undefined } };
}

/** The reader's state after the last line. */
export interface EndState {
	/** The last line is in a block that a blank line does not close: HTML of types 1, 3-5, or display math. */
	open: boolean;
	/** Text at the end may be shown as written or literal: in an HTML block or paragraph, after pending math, or in a construct spanning lines. */
	literal: boolean;
}
// CommonMark HTML block types 1, 3, 4 and 5 (as marked's html rule): the opening and the end marker.
const HTML_UNTIL: [RegExp, RegExp][] = [
	[/^<(?:pre|script|style|textarea)(?:\s|>|$)/i, /<\/(?:pre|script|style|textarea)>/i],
	[/^<\?/, /\?>/],
	[/^<!\[CDATA\[/, /\]\]>/],
	[/^<![A-Za-z]/, />/],
];

// CommonMark HTML block type 6 (marked's tag list): it ends at a blank line and may interrupt a paragraph.
const HTML_FLOW = /^<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|\/?>|$)/i;

/** Line k opens a display math block that pi's parser takes: closed, or pending with math in it. */
function opensMathBlock(lines: string[], k: number, see: (k: number) => void): boolean {
	const content = lines[k].replace(/^ {0,3}/, "");
	if (!(content.startsWith("$$") || content.startsWith("\\["))) return false;
	const end = mathBlockEnd(lines, k, content);
	see(end >= 0 ? end : lines.length);
	if (end >= 0 || content[0] === "\\") return true;
	return PENDING_MATH.test([content.slice(2), ...lines.slice(k + 1)].join("\n"));
}

/** "\\" before index i of text escapes it: an odd number of backslashes. */
function escapedAt(text: string, i: number): boolean {
	let n = 0;
	while (i - n - 1 >= 0 && text[i - n - 1] === "\\") n++;
	return n % 2 === 1;
}

/**
 * The end of the inline math that opens at p of a line, or -1. Follows pi-tui's tokenizeInlineLatex. Math
 * never holds a line break, so a closing mark on a later line makes no math; neither does a pending
 * (unclosed) opening, which pi shows as written.
 */
const PENDING = -2;
// pi-tui's looksLikePendingDollarMath.
const PENDING_MATH = /\\[A-Za-z]+|[_^=+*/<>()[\]|±≤≥≠≈∈→⇒∞∫∑√-]/;
const hasClosing = (text: string, close: string) => {
	for (let at = text.indexOf(close); at >= 0; at = text.indexOf(close, at + close.length)) if (!escapedAt(text, at)) return true;
	return false;
};

function inlineMathEnd(text: string, p: number): number {
	let open: string;
	let close: string;
	if (text.startsWith("$$", p)) open = close = "$$";
	else if (text.startsWith("\\(", p)) [open, close] = ["\\(", "\\)"];
	else if (text.startsWith("\\[", p)) [open, close] = ["\\[", "\\]"];
	else if (text[p] === "$" && p + 1 < text.length && !/\s/.test(text[p + 1])) open = close = "$";
	else return -1;
	let end = text.indexOf(close, p + open.length);
	while (end >= 0 && escapedAt(text, end)) end = text.indexOf(close, end + close.length);
	if (end < 0) return PENDING;
	const body = text.slice(p + open.length, end);
	if (!body) return -1;
	const after = text.slice(end + 1);
	if (open === "$" && (/\s$/.test(body) || /^\d/.test(after) || body.includes("\x60") || (/^[A-Z_][A-Z0-9_]*(?:[^A-Za-z0-9_\s])?$/.test(body) && /^[A-Za-z_]/.test(after)))) return -1;
	return end + close.length;
}

/**
 * The last line of the display math block that content (line i after its container markers) opens, or -1.
 * Follows pi-tui's tokenizeBlockLatex: the math between the marks is not empty and holds no table start.
 */
function mathBlockEnd(lines: string[], i: number, content: string): number {
	const marks = MATH_MARKS.find((m) => m.open.test(content));
	if (!marks) return -1;
	const MATH_CLOSE = marks.close;
	const open = content.match(marks.open)!;
	const rest = content.slice(open[0].length);
	const close = rest.match(MATH_CLOSE);
	if (close) return rest.length > close[0].length ? i : PENDING;
	const math = [rest];
	for (let k = i + 1; k < lines.length; k++) {
		// At top level pi's math block runs over the raw lines, whatever blocks they would open.
		const end = lines[k].match(MATH_CLOSE);
		math.push(end ? lines[k].slice(0, end.index) : lines[k]);
		if (!end) continue;
		// pi drops the line break right after the opening "$$"; nothing else may be left.
		const body = (rest === "" ? math.slice(1) : math).join("\n");
		// An empty block or one with a table start: pi reads the opening as pending math instead.
		if (!body) return PENDING;
		const rows = body.split("\n");
		for (let r = 0; r + 1 < rows.length; r++) if ((rows[r + 1].includes("|") || rows[r].includes("|")) && TABLE_DELIMITER.test(rows[r + 1])) return PENDING;
		return k;
	}
	return PENDING;
}

/**
 * Where the count line goes in a reply that ends inside an open block (elsewhere it goes after the last block,
 * see decorate in index.ts): after the reply's first block when that is a top-level paragraph or heading
 * closed by a blank line, otherwise above the first block. Both are top-level block boundaries, so the
 * inserted line and its blank line never join, split or enter another block.
 */
export function countPlace(read: ReadLine[]): number {
	const first = read.findIndex((l) => l.kind !== "blank");
	if (first < 0) return 0;
	let end = first;
	if (read[first].kind === "heading") end = read[first].plain ? first + 1 : first;
	else while (end < read.length && read[end].kind === "prose" && read[end].plain) end++;
	return end > first && read[end]?.kind === "blank" ? end + 1 : first;
}


// ---------------------------------------------------------------------------------------------------------------
// Strong pairs: which "**" and "__" runs pi's parser pairs as bold. A port of the inline lexer loop of marked
// 18.0.11 (gfm, not breaks) with the emStrong tokenizer of marked-cjk-friendly 0.1.2, as pi-tui 1.5.2 configures
// them (components/markdown.js). The regular expressions are copied from those two packages; neither loads here.
// Code spans, math, HTML and autolinks are the reader's literal ranges (one token each, as pi's tokenizers read
// them). Not ported: reference links with a definition (read as text, like an undefined reference).
// ---------------------------------------------------------------------------------------------------------------

/** marked-cjk-friendly: characters that count as punctuation next to an emphasis delimiter. */
const CJK = "\\u1100-\\u11ff\\u20a9\\u2329-\\u232a\\u2630-\\u2637\\u268a-\\u268f\\u2e80-\\u2e99\\u2e9b-\\u2ef3\\u2f00-\\u2fd5\\u2ff0-\\u303e\\u3041-\\u3096\\u3099-\\u30ff\\u3105-\\u312f\\u3131-\\u318e\\u3190-\\u31e5\\u31ef-\\u321e\\u3220-\\u3247\\u3250-\\ua48c\\ua490-\\ua4c6\\ua960-\\ua97c\\uac00-\\ud7a3\\ud7b0-\\ud7c6\\ud7cb-\\ud7fb\\uf900-\\ufaff\\ufe10-\\ufe19\\ufe30-\\ufe52\\ufe54-\\ufe66\\ufe68-\\ufe6b\\uff01-\\uffbe\\uffc2-\\uffc7\\uffca-\\uffcf\\uffd2-\\uffd7\\uffda-\\uffdc\\uffe0-\\uffe6\\uffe8-\\uffee\\u{16fe0}-\\u{16fe4}\\u{16ff0}-\\u{16ff6}\\u{17000}-\\u{18cda}\\u{18cff}-\\u{18d20}\\u{18d80}-\\u{18df2}\\u{18e00}-\\u{19191}\\u{191a0}-\\u{191d2}\\u{1aff0}-\\u{1aff3}\\u{1aff5}-\\u{1affb}\\u{1affd}-\\u{1affe}\\u{1b000}-\\u{1b128}\\u{1b132}\\u{1b150}-\\u{1b152}\\u{1b155}\\u{1b164}-\\u{1b168}\\u{1b170}-\\u{1b2fb}\\u{1d300}-\\u{1d356}\\u{1d360}-\\u{1d376}\\u{1f1ae}\\u{1f200}\\u{1f202}\\u{1f210}-\\u{1f219}\\u{1f21b}-\\u{1f22e}\\u{1f230}-\\u{1f231}\\u{1f237}\\u{1f23b}\\u{1f240}-\\u{1f248}\\u{1f260}-\\u{1f265}\\u{1f7da}\\u{20000}-\\u{3fffd}";
export const CJK_CHAR = new RegExp(`[${CJK}]`, "u");
const PREV_CJK = new RegExp(`^((?![*_])[\\s\\p{P}\\p{S}${CJK}])`, "u");
const PUNCT_CJK = `(?!~)[\\p{P}\\p{S}${CJK}]`;
const PUNCT_SPACE_CJK = `(?!~)[\\s\\p{P}\\p{S}${CJK}]`;
const NOT_PUNCT_SPACE_CJK = `(?:[^\\s\\p{P}\\p{S}${CJK}]|~)`;
const PUNCT_CJK_UND = `[\\p{P}\\p{S}${CJK}]`;
const PUNCT_SPACE_CJK_UND = `[\\s\\p{P}\\p{S}${CJK}]`;
const NOT_PUNCT_SPACE_CJK_UND = `[^\\s\\p{P}\\p{S}${CJK}]`;
/** The right delimiter scans of marked-cjk-friendly (buildRDelimAst with the gfm classes, buildRDelimUnd). */
const R_DELIM_AST = new RegExp(
	`^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)${PUNCT_CJK}(\\*+)(?=[\\s]|$)|${NOT_PUNCT_SPACE_CJK}(\\*+)(?!\\*)(?=${PUNCT_SPACE_CJK}|$)|(?!\\*)${PUNCT_SPACE_CJK}(\\*+)(?=${NOT_PUNCT_SPACE_CJK})|[\\s](\\*+)(?!\\*)(?=${PUNCT_CJK})|(?!\\*)${PUNCT_CJK}(\\*+)(?!\\*)(?=${PUNCT_CJK})|${NOT_PUNCT_SPACE_CJK}(\\*+)(?=${NOT_PUNCT_SPACE_CJK})`,
	"gu",
);
const R_DELIM_UND = new RegExp(
	`^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)${PUNCT_CJK_UND}(_+)(?=[\\s]|$)|${NOT_PUNCT_SPACE_CJK_UND}(_+)(?!_)(?=${PUNCT_SPACE_CJK_UND}|$)|(?!_)${PUNCT_SPACE_CJK_UND}(_+)(?=${NOT_PUNCT_SPACE_CJK_UND})|[\\s](_+)(?!_)(?=${PUNCT_CJK_UND})|(?!_)${PUNCT_CJK_UND}(_+)(?!_)(?=${PUNCT_CJK_UND})`,
	"gu",
);
// The scans without their first alternative, which matches only at the start of the scanned text: read on the
// whole masked text from an index when that alternative does not match there (no slice per opener).
const FIRST_AST = /[^_*]*?__[^_*]*?\*[^_*]*?(?=__)/y;
const FIRST_UND = /[^_*]*?\*\*[^_*]*?_[^_*]*?(?=\*\*)/y;
const R_DELIM_AST_REST = new RegExp(R_DELIM_AST.source.slice(R_DELIM_AST.source.indexOf("|") + 1), "gu");
const R_DELIM_UND_REST = new RegExp(R_DELIM_UND.source.slice(R_DELIM_UND.source.indexOf("|") + 1), "gu");
/** marked's gfm emStrongLDelim, punctuation and unicodeAlphaNumeric rules, sticky instead of anchored. */
const L_DELIM = /(?:\*+(?:((?!\*)(?!~)[\p{P}\p{S}])|([^\s*]))?)|_+(?:((?!_)(?!~)[\p{P}\p{S}])|([^\s_]))?/uy;
const PUNCTUATION_BEFORE = /^((?![*_])[\s\p{P}\p{S}])/u;
const ALPHANUMERIC = /[\p{L}\p{N}]/u;
const ESCAPE = /\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_\x60{|}~])/y;
const ANY_PUNCTUATION = /\\[\p{P}\p{S}]/gu;
/** marked's blockSkip: inline links, code spans and HTML tags, masked so that no delimiter inside them pairs. */
/** Signs without which BLOCK_SKIP masks nothing. */
const MAY_SKIP = /\]\(|\x60|</;
const BLOCK_SKIP = /\[(?:[^\[\]\x60]|(?<a>\x60+)[^\x60]+\k<a>(?!\x60))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)|(?<!\x60)()(?<b>\x60+)[^\x60]+\k<b>(?!\x60)|<(?! )[^<>]*?>/g;
const LINK_LABEL = String.raw`(?:\[(?:\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|\x60+(?!\x60)[^\x60]*?\x60+(?!\x60)|\x60\x60+(?=\])|[^\[\]\\\x60])*?`;
const LINK = new RegExp(
	String.raw`!?\[(${LINK_LABEL})\]\(\s*(<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]+|(?=\)))(?:(?:[ \t]+(?:\n[ \t]*)?|\n[ \t]*)("(?:\\"?|[^"\\])*"|'(?:\\'?|[^'\\])*'|\((?:\\\)?|[^)\\])*\)))?\s*\)`,
	"y",
);
const REF = String.raw`(?!\s*\])(?:\\[\s\S]|[^\[\]\\])+`;
const REFLINK = new RegExp(String.raw`!?\[(${LINK_LABEL})\]\[(${REF})\]|!?\[(${REF})\](?:\[\])?`, "y");
/** pi's strict strikethrough. */
const DEL = /(~~)(?=[^\s~])((?:\\.|[^\\])*?(?:\\.|[^\s~\\]))\1(?=[^~]|$)/y;
const BR = /( {2,}|\\)\n(?!\s*$)/y;
const GFM_URL = /((?:[hH][tT][tT][pP][sS]?|[fF][tT][pP]):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![-_])/y;
const BACKPEDAL = /^(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/;
// marked's gfm inlineText rule. "protocol" is not grouped there, so text stops before any "http" or "ftp".
const TEXT = /(\x60+|~+|[^\x60~])(?:(?=[\x60~])|(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_\x60{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[\x60*~_]|\b_|[hH][tT][tT][pP][sS]?|[fF][tT][pP]:\/\/|www\.|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9.!#$%&'*+\/=?_\x60{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_\x60{\|}~-]+@)))/y;
/** Where pi's inline math extension may start (its startInline): text stops before it. */
const MATH_START = /\$|\\[(\[]/g;

/** A strong span pi draws: the starts of its opening and closing two-character delimiters. */
export type StrongPair = [open: number, close: number];

/** marked-cjk-friendly isPrevCharCjk: maskedSrc.length - src.length is the index at. */
function prevIsCjk(prev: string, masked: string, at: number): boolean {
	let cjk = PREV_CJK.test(prev);
	if (!cjk && prev && at >= 1) {
		let idx = at - 1;
		let code = masked.charCodeAt(idx);
		if (code >= 65024 && code <= 65038 && idx >= 1) code = masked.charCodeAt(--idx);
		if ((code & 64512) === 56320 && idx >= 1) {
			const cp = masked.codePointAt(idx - 1);
			if (cp !== undefined && cp > 65535) cjk = (cp >= 917760 && cp <= 917999) || CJK_CHAR.test(String.fromCodePoint(cp));
		} else cjk = CJK_CHAR.test(String.fromCharCode(code));
	}
	return cjk;
}

/** marked-cjk-friendly emStrong at index at of text: the token's end and its delimiter lengths, or undefined. */
function emStrongAt(text: string, masked: string, at: number, prev: string): { end: number; strong: boolean } | undefined {
	L_DELIM.lastIndex = at;
	const match = L_DELIM.exec(text);
	if (!match || !(match[1] || match[2] || match[3] || match[4])) return undefined;
	if (match[4] && ALPHANUMERIC.test(prev)) return undefined;
	const next = match[1] || match[3] || "";
	if (!(!next || !prev || PUNCTUATION_BEFORE.test(prev) || prevIsCjk(prev, masked, at) || CJK_CHAR.test(next))) return undefined;
	const lLength = [...match[0]].length - 1;
	let delimTotal = lLength;
	let midDelimTotal = 0;
	const sameBefore = prev === match[0][0];
	const ast = match[0][0] === "*";
	const first = ast ? FIRST_AST : FIRST_UND;
	first.lastIndex = at + lLength;
	// clipped starts at offset in masked.
	let clipped = masked;
	let offset = at + lLength;
	let endReg = ast ? R_DELIM_AST_REST : R_DELIM_UND_REST;
	endReg.lastIndex = offset;
	if (first.test(masked)) {
		clipped = masked.slice(offset);
		offset = 0;
		endReg = ast ? R_DELIM_AST : R_DELIM_UND;
		endReg.lastIndex = 0;
	}
	let r: RegExpExecArray | null;
	while ((r = endReg.exec(clipped)) !== null) {
		const delim = r[1] || r[2] || r[3] || r[4] || r[5] || r[6];
		if (!delim) continue;
		let rLength = [...delim].length;
		let cjkAdjacent = false;
		if (r[1] || r[2] || r[3] || r[4]) {
			const before = String.fromCodePoint(r[0].codePointAt(0)!);
			const after = r.index + r[0].length < clipped.length ? String.fromCodePoint(clipped.codePointAt(r.index + r[0].length)!) : "";
			cjkAdjacent = CJK_CHAR.test(before) || CJK_CHAR.test(after);
		}
		const leftOnly = Boolean(r[3] || r[4]);
		const both = Boolean(r[5] || r[6]);
		if (leftOnly && !cjkAdjacent) {
			delimTotal += rLength;
			continue;
		}
		if (both || cjkAdjacent) {
			if (lLength % 3 && !((lLength + rLength) % 3)) {
				midDelimTotal += rLength;
				continue;
			}
			if (sameBefore && both) break;
		}
		delimTotal -= rLength;
		if (delimTotal > 0) continue;
		rLength = Math.min(rLength, rLength + delimTotal + midDelimTotal);
		const lastCharLength = r[0].codePointAt(0)! > 65535 ? 2 : 1;
		return { end: at + lLength + (r.index - offset) + lastCharLength + rLength, strong: Math.min(lLength, rLength) % 2 === 0 };
	}
	return undefined;
}

/**
 * The strong spans pi's parser makes in inline text (a paragraph's lines joined with "\n"), at every nesting
 * level. literal: the reader's literal ranges in text coordinates, sorted.
 */
export function strongPairs(text: string, literal: Range[]): { pairs: StrongPair[]; crossesLine: boolean } {
	const read: Lexed = { pairs: [], crossesLine: false, links: text.includes("](") };
	lexInline(text, 0, text.length, literal, false, read, !URL_SIGN.test(text));
	return { pairs: read.pairs, crossesLine: read.crossesLine };
}

/** What lexInline reads: the strong pairs; whether a link, emphasis or strikethrough token spans a line break. */
interface Lexed {
	pairs: StrongPair[];
	crossesLine: boolean;
	/** The text holds "](": only then may a "[" open an inline link. */
	links: boolean;
}
const spans = (text: string, start: number, end: number) => text.slice(start, end).includes("\n");

/** Text where a bare URL or email may start: only there do text tokens end at places other than NEXT_SIGN. */
const URL_SIGN = /[A-Za-z0-9._+-]@[a-zA-Z0-9-_]+\.|:\/\/|www\./;
/** The characters where a token other than text may start, without URLs: escape, link, emphasis, strikethrough. */
const NEXT_SIGN = /[\\\[!*_~]/g;

/**
 * fast: the text holds no URL_SIGN. Text tokens then matter only through the character before the next
 * escape, link, emphasis or strikethrough sign (the previous character pi's emphasis rule reads), so a text
 * token runs to the next such sign or literal range. Other stops of marked's text rule split text tokens
 * without changing that character, and a line break token leaves it whitespace or empty, which the emphasis
 * rule reads alike.
 */
const NO_EMPHASIS_SIGN = /[^*_]*/y;
function lexInline(all: string, from: number, to: number, literal: Range[], inLink: boolean, read: Lexed, fast: boolean): void {
	// Text without "*" or "_" holds no strong span and no token that could hold one.
	NO_EMPHASIS_SIGN.lastIndex = from;
	NO_EMPHASIS_SIGN.exec(all);
	if (NO_EMPHASIS_SIGN.lastIndex >= to) return;
	const text = all.slice(from, to);
	let masked = text.includes("\\") ? text.replace(ANY_PUNCTUATION, (s) => "+".repeat(s.length)) : text;
	if (MAY_SKIP.test(masked)) masked = masked.replace(BLOCK_SKIP, (s) => "[" + "a".repeat(s.length - 2) + "]");
	let r = 0;
	let prev = "";
	let lastText = false;
	// The next possible math start after the current index, -1 for none left.
	let math = -2;
	for (let i = 0; i < text.length; ) {
		if (!lastText) prev = "";
		lastText = false;
		while (r < literal.length && literal[r][1] <= from + i) r++;
		if (r < literal.length && literal[r][0] <= from + i) {
			i = Math.min(text.length, literal[r][1] - from);
			continue;
		}
		const c = text[i];
		if (c === "\\") {
			ESCAPE.lastIndex = i;
			if (ESCAPE.test(text)) {
				i += 2;
				continue;
			}
		}
		// In fast text an undefined reference reads like text: its "[" token leaves an empty previous character,
		// which the emphasis rule reads like the punctuation "[".
		if ((c === "[" || (c === "!" && text[i + 1] === "[")) && (read.links || !fast)) {
			LINK.lastIndex = i;
			const link = read.links ? LINK.exec(text) : null;
			if (link) {
				read.crossesLine ||= spans(text, i, i + link[0].length);
				const start = i + link[0].indexOf("[") + 1;
				lexInline(all, from + start, from + start + link[1].length, literal, true, read, fast);
				i += link[0].length;
				continue;
			}
			REFLINK.lastIndex = i;
			if (REFLINK.test(text)) {
				i += 1;
				continue;
			}
		}
		if (c === "*" || c === "_") {
			const token = emStrongAt(text, masked, i, prev);
			if (token) {
				const width = token.strong ? 2 : 1;
				// A link's text is drawn as written: a color escape there would end the link label.
				if (token.strong && !inLink) read.pairs.push([from + i, from + token.end - 2]);
				read.crossesLine ||= spans(text, i, token.end);
				lexInline(all, from + i + width, from + token.end - width, literal, inLink, read, fast);
				i = token.end;
				continue;
			}
		}
		if (c === "~") {
			DEL.lastIndex = i;
			const del = DEL.exec(text);
			if (del) {
				read.crossesLine ||= spans(text, i, i + del[0].length);
				lexInline(all, from + i + 2, from + i + 2 + del[2].length, literal, inLink, read, fast);
				i += del[0].length;
				continue;
			}
		}
		if (fast) {
			let end = text.length;
			if (r < literal.length) end = Math.min(end, literal[r][0] - from);
			NEXT_SIGN.lastIndex = i + 1;
			const sign = NEXT_SIGN.exec(text);
			if (sign && sign.index < end) end = sign.index;
			const last = text[end - 1];
			i = end;
			if (last !== "_") prev = last;
			lastText = true;
			continue;
		}
		if (c === " " || c === "\\") {
			BR.lastIndex = i;
			const br = BR.exec(text);
			if (br) {
				i += br[0].length;
				continue;
			}
		}
		if (!inLink) {
			GFM_URL.lastIndex = i;
			const url = GFM_URL.exec(text);
			if (url) {
				let raw = url[0];
				if (url[2] !== "@") {
					let before: string;
					do {
						before = raw;
						raw = BACKPEDAL.exec(raw)?.[0] ?? "";
					} while (before !== raw);
				}
				if (raw.length > 0) {
					i += raw.length;
					continue;
				}
			}
		}
		// The text token stops before a possible math start (pi's startInline) and before a literal range.
		let cut = r < literal.length ? Math.min(text.length, literal[r][0] - from) : text.length;
		if (math !== -1 && math < i + 1) {
			MATH_START.lastIndex = i + 1;
			math = MATH_START.exec(text)?.index ?? -1;
		}
		if (math >= 0 && math < cut) cut = math;
		// The rule read on the whole text ends at its first stop; marked reads it on the text up to the cut, where
		// its "$" ends it: the end is the earlier of the two.
		TEXT.lastIndex = i;
		const piece = TEXT.exec(text);
		const end = Math.max(i + 1, Math.min(cut, piece ? i + piece[0].length : i + 1));
		const last = text[end - 1];
		i = end;
		if (last !== "_") prev = last;
		lastText = true;
	}
}


/**
 * How pi's right delimiter scan reads a run of "**" or "__" between the characters before and after it: as a
 * left-only, right-only or both-flanking delimiter (next to CJK text: both), or not at all ("" before it: the
 * scan starts at the run).
 */
const runKinds = new Map<string, "left" | "right" | "both" | "none">();
export function runKind(before: string, run: string, after: string): "left" | "right" | "both" | "none" {
	const key = before + run + after;
	let kind = runKinds.get(key);
	if (kind === undefined) {
		// Keys are at most two characters around a run: the memo stays small.
		if (runKinds.size > 4096) runKinds.clear();
		runKinds.set(key, (kind = readRunKind(before, run, after)));
	}
	return kind;
}
function readRunKind(before: string, run: string, after: string): "left" | "right" | "both" | "none" {
	const scan = run[0] === "*" ? R_DELIM_AST : R_DELIM_UND;
	const text = before + run + after;
	scan.lastIndex = 0;
	let r: RegExpExecArray | null;
	while ((r = scan.exec(text)) !== null) {
		if (!(r[1] || r[2] || r[3] || r[4] || r[5] || r[6])) continue;
		if (r[5] || r[6] || CJK_CHAR.test(before) || CJK_CHAR.test(after)) return "both";
		return r[3] || r[4] ? "left" : "right";
	}
	return "none";
}
