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
// marked's fence: the info string runs to the line break, so it may hold U+2028 and U+2029.
const FENCE_OPEN = /^(\x60{3,}|~{3,})([^\n]*)$/;
/** body closes the fence: marked's closer is the opener's run, then any "~" or backtick, then spaces. */
const closesFence = (body: string, char: string, length: number) => body.startsWith(char.repeat(length)) && /^[~\x60]* *$/.test(body.slice(length));
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
/** The characters where the inline scan stops: code span, comment, math, escape or another construct. */
const SPECIAL = /[\\\x60$<[\]()*_~>]/g;
/** An email candidate's local part and its "@" (skipped when it is no email). */
const EMAIL_HEAD = /[A-Za-z0-9._+-]*@/y;
const WORD_CHAR = /[\p{L}\p{N}]/u;
const SPACE = /\s/;
/** "://", "www." or "@": a line without any of them holds no bare URL or email start. */
const URL_OR_EMAIL_SIGN = /:\/\/|www\.|@/;
// A link title (marked's title rule); it may hold line breaks.
const LINK_TITLE = String.raw`(?:"(?:\\"?|[^"\\])*"|'(?:\\'?|[^'\\])*'|\((?:\\\)?|[^)\\])*\))`;
// A link reference definition (marked's def rule): pi shows nothing of it. Its destination and its title may
// each sit on the next line. Matched against the definition's lines joined with "\n".
const DEFINITION = new RegExp(String.raw`^\[(?!\s*\])((?:\\[\s\S]|[^\[\]\\])+)\]: *(?:\n[ \t]*)?(?:[^<\s]\S*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)${LINK_TITLE})? *(?=\n|$)`);
// The label of a line that may define a link (looser than DEFINITION: used to know which labels pi can link),
// after any block quote and list markers, in any order and nesting.
const DEFINED_LABEL = /^[ \t]*(?:>[ \t]*|(?:[-*+]|\d{1,9}[.)])[ \t]+)*\[((?:\\.|[^\[\]\\])+)\]:/;
// A line that opens a label without closing it: a definition's label may go on over the next lines.
const LABEL_OPEN = /^[ \t]*(?:>[ \t]*|(?:[-*+]|\d{1,9}[.)])[ \t]+)*\[((?:\\.|[^\[\]\\])*\\?)$/;
// A line that closes a label opened on an earlier line and defines it.
const LABEL_TAIL = /^(?:\\.|[^\[\]\\])*\]:/;
// A loose key: a label without white space, backslashes and ">" (quote markers inside a split label), so every
// spelling pi may match maps to one key. Looser than pi's matching: a use may read as defined when it is not,
// which only protects more text.
const labelKey = (label: string) => label.replace(/[\s\\>]+/g, "").toLowerCase();
// An inline link's destination and title from its "(" (marked's link rule), over lines joined with "\n".
// The same with marked's loose destination (any run without spaces, nested parentheses too): read when the strict
// rule fails, so a target the reader cannot bound exactly is still protected (it may protect more than pi links).
const LOOSE_TARGET = new RegExp(String.raw`^\(\s*(?:<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]+)(?:(?:[ \t]+(?:\n[ \t]*)?|\n[ \t]*)${LINK_TITLE})?\s*\)`);
const LINK_TARGET = new RegExp(String.raw`^\(\s*(?:<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f()]*(?:\([^ \t\n\x00-\x1f()]*\)[^ \t\n\x00-\x1f()]*)*)(?:(?:[ \t]+(?:\n[ \t]*)?|\n[ \t]*)${LINK_TITLE})?\s*\)`);
// An autolink (marked's autolink rule): its target is the link, never prose.
const AUTOLINK = /^<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s\x00-\x1f<>]*|[A-Za-z0-9.!#$%&'*+/=?^_\x60{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+)>/;

// pi-tui 1.5.2's cjkPunctuationRegex (utils.js, not exported): its bare URLs stop at CJK punctuation.
const CJK_PUNCTUATION = /(?:(?=\p{Punctuation})[\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}\p{Script_Extensions=Hangul}\p{Script_Extensions=Bopomofo}]|[，．：；！？（）［］｛｝“”‘’…—])/u;
const URL_START = /(?:[hH][tT][tT][pP][sS]?|[fF][tT][pP]):\/\/|www\.|[A-Za-z0-9._+-]+@/g;
/** The start of the next bare URL candidate at or after from, or -1. */
function urlStart(text: string, from: number): number {
	URL_START.lastIndex = from;
	return URL_START.exec(text)?.index ?? -1;
}
/** The end of the bare URL or email address at index at (pi's url token, piUrlLength), or -1. */
function urlEnd(text: string, at: number): number {
	const length = piUrlLength(text, at);
	return length > 0 ? at + length : -1;
}
/** The index of the "]" that closes the reference label opening at from, or -1 at an unescaped "[" or none. */
function labelEnd(text: string, from: number): number {
	for (let q = from; q < text.length; q++) {
		const c = text[q];
		if (c === "\\") q++;
		else if (c === "[") return -1;
		else if (c === "]") return q;
	}
	return -1;
}
/** The index of the first "[" or "]" of text that no backslash escapes, or -1 (a label holds none). */
const bareBracketAt = (text: string) => {
	for (let q = 0; q < text.length; q++) {
		const c = text[q];
		if (c === "\\") q++;
		else if (c === "[" || c === "]") return q;
	}
	return -1;
};
const hasBareBracket = (text: string) => bareBracketAt(text) >= 0;
/** The index in line of index e of its tab-expanded form (pi's three spaces per tab). */
function originalIndex(line: string, e: number): number {
	if (!line.includes("\t")) return e;
	let x = 0;
	for (let o = 0; o < line.length; o++) {
		if (x >= e) return o;
		x += line[o] === "\t" ? 3 : 1;
	}
	return line.length;
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

// A line indented less than a list item's content that ends the item for marked (its fence, heading, HTML,
// quote and bullet starts; thematic breaks are tested apart).
const ITEM_BREAK = /^(?:\x60\x60\x60|~~~|#|<(?:[a-z].*>|!--)|>|(?:[*+-]|\d{1,9}[.)])(?:[ \t]|$))/i;
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

/**
 * A line that may define a link label (the opening line of a label, or the line that closes one opened on an
 * earlier line): a reference link before it may read differently once it arrives. A superset of the lines
 * that complete a label in the reference reader (labelsOf).
 */
export const mayDefine = (line: string) => line.includes("]:") && (DEFINED_LABEL.test(line) || LABEL_TAIL.test(line));

/** Per label key, the lines that may define it: a label on one line, or one that goes on over the next lines. */
function labelsOf(lines: string[]): Map<string, number[]> {
	const labels = new Map<string, number[]>();
	const add = (label: string, line: number) => {
		const key = labelKey(label);
		const at = labels.get(key);
		if (at) at.push(line);
		else labels.set(key, [line]);
	};
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!line.includes("[")) continue;
		const m = line.includes("]:") ? line.match(DEFINED_LABEL) : null;
		if (m) {
			add(m[1], i);
			continue;
		}
		const open = line.match(LABEL_OPEN);
		if (!open) continue;
		// marked's label may hold line breaks, blank lines too, up to its "]" (the loose key drops container
		// markers). A label holds no bare bracket, so each scan stops at the next opener: linear in the reply.
		let label = open[1];
		for (let k = i + 1; k < lines.length; k++) {
			const tail = lines[k].match(LABEL_TAIL);
			if (tail) {
				add(label + "\n" + tail[0].slice(0, -2), i);
				break;
			}
			if (hasBareBracket(lines[k])) break;
			label += "\n" + lines[k];
		}
	}
	return labels;
}

export function readMarkdown(lines: string[]): ReadLine[] {
	return readBlocks(lines).read;
}

/**
 * The reading of readMarkdown plus the last finished-block boundary: the last blank line b after which the
 * reader's state equals its start state and whose lines 0..b were read without looking past line b. Then the
 * reading of lines 0..b does not depend on the lines after b, and the reading of the lines after b equals
 * the reading of those lines alone (with indexes shifted by b + 1). -1 when there is none.
 */
// definitions: false when no line holds "]:" (the caller read its text once), so no line may define a label.
export function readBlocks(lines: string[], definitions = true): { read: ReadLine[]; boundary: number; end: EndState } {
	const first = readPass(lines, undefined, definitions);
	// A label that only lines in a fenced code block define links nothing for pi: read again without those
	// lines. (Rare: only a reference used in prose with its only definition in such a fence reads twice.)
	return first.fencedOnly ? readPass(lines, first.sureFences, definitions) : first;
}

/** A top-level fence the reader is sure of: no HTML, math or container around its opening line. */
interface SureFence {
	/** The line after its opening line. */
	start: number;
	char: string;
	length: number;
	/** The first line from start on that opens with the fence's run (read once, when first needed). */
	end?: number;
}
/**
 * Line j is inside a sure fence. Its end is read loosely: any line that opens with the fence's character run
 * ends it, so a closing line the reader would not take never extends the fence over a real definition.
 */
function inSureFence(lines: string[], fences: SureFence[], j: number): boolean {
	return fences.some((f) => {
		if (f.end === undefined) {
			const run = f.char.repeat(f.length);
			let k = f.start;
			while (k < lines.length && !lines[k].replace(/^[ \t]*/, "").startsWith(run)) k++;
			f.end = k;
		}
		return f.start <= j && j < f.end;
	});
}

/** One reading. skip: the sure fences of a first reading, whose lines define no label in this one. */
function readPass(lines: string[], skip?: SureFence[], definitions = true): { read: ReadLine[]; boundary: number; end: EndState; fencedOnly: boolean; sureFences: SureFence[] } {
	const read: ReadLine[] = [];
	const sureFences: SureFence[] = [];
	const skipFenced = skip !== undefined;
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
	// chain: the opening line may be HTML text for pi, so a closing line may open pi's fence.
	// item: the content column of the list item around the block (0 when none).
	// onMarker: the opening line opens the list item too.
	let fence: { char: string; length: number; base: number; depth: number; line: number; chain: boolean; item: number; onMarker: boolean } | undefined;
	// A block HTML comment that has not ended yet, in its container; html: the HTML block it opened in.
	let comment: { depth: number; base: number; line: number; item: number; onMarker: boolean; html: false | "flow" | RegExp } | undefined;
	// A comment that opened inside the text of an HTML block on line, at column at: the line is literal from there.
	let rawOpen: { line: number; at: number } | undefined;
	// The content column of a list item the reader stopped following at a change of quote depth; 0 when none.
	let lostItem = 0;
	// The content column of an outer list item that pi may keep lazily after a line left a fence in a nested
	// item; 0 when none. The reader then reads a line indented less than 4 past it as that item's text.
	let lazyItem = 0;
	// The line at which the last fence was left (its container ended).
	let leftAt = -1;
	let leftBase = 0;
	// The line that left a fence in a block quote: pi may keep it in the quote as a lazy paragraph line.
	let leftQuoteAt = -1;
	// The line of a sure pending display math mark (pi shows the rest as written); -1 when none.
	let writtenFrom = -1;
	// An HTML block that opened a block quote's or a list item's content, as marked reads it there: its lines are
	// HTML text (no fence opens) up to its end marker (types 1, 3-5), a blank line (types 6, 7) or the container's end.
	let itemHtml: { depth: number; base: number; line: number; item: number; onMarker: boolean; end: RegExp | "flow" } | undefined;
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
	// In an HTML block pi shows the text as written: link metadata is drawn as before. A line that opens with
	// "<" but opens no HTML block (an autolink, an inline tag) and a line after an HTML block's closing line
	// are not: their links stay literal.
	const asWritten = () => mathOff || pendingMath || containerMath || htmlShown;
	// The current line is in an HTML block (htmlShown); the block that goes on after it: to a blank line, or
	// (types 1, 3-5) to its end marker.
	let htmlShown = false;
	let htmlShow: false | "flow" | RegExp = false;
	// The line that closed the last HTML block of types 1, 3-5: the next line starts a new block.
	let htmlShownEnd = -2;
	// Set at a math mark in a quote or a list item, where the reader does not follow pi's math: pi may show the
	// rest as written. Link metadata is then drawn as before. Cleared at the next top-level block after a blank line.
	let containerMath = false;
	// A line up to the last blank line may define a link label.
	let definitionSeen = false;
	let definitionChecked = 0;
	// The labels that a definition line may define (for reference links), read once per reading when needed.
	let defined: Map<string, number[]> | undefined;
	const isDefined = (label: string) => {
		// A label holds no unescaped bracket.
		if (hasBareBracket(label)) return false;
		defined ??= labelsOf(lines);
		const at = defined.get(labelKey(label));
		if (!at) return false;
		// The reading now depends on a defining line: no finished-block boundary falls before it, so no cached
		// head depends on a later line that a replaced suffix may drop.
		see(at[0]);
		// The first reading does not know the fences after this line yet: it takes the label as defined, and
		// readBlocks reads again when only fenced lines define it (checked after the reading).
		if (!skipFenced) {
			consulted.add(labelKey(label));
			return true;
		}
		return at.some((j) => !inSureFence(lines, skip, j));
	};
	const consulted = new Set<string>();
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
			// A line that may open another block is taken too: if pi ends the paragraph there, the text it shows
			// as written is only protected more.
			if (!next.body.trim() || next.depth !== blockOf(text).depth) break;
			see(k);
			starts.push(joined.length + 1);
			joined += "\n" + next.body;
		}
		if (starts.length === 0) return undefined;
		const m = joined.match(LINK_TARGET) ?? joined.match(LOOSE_TARGET);
		if (!m || !m[0].includes("\n")) return undefined;
		let k = starts.length - 1;
		while (k >= 0 && starts[k] > m[0].length) k--;
		if (k < 0) return [i, at + m[0].length];
		// The end in the line as written: pi read it with each tab as three spaces.
		const line = lines[i + 1 + k];
		const expanded = line.includes("\t") ? line.replace(/\t/g, "   ") : line;
		return [i + 1 + k, originalIndex(line, expanded.length - blockOf(line).body.length + m[0].length - starts[k])];
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
		// (One search for all three signs first: most lines hold none.)
		const signs = URL_OR_EMAIL_SIGN.test(text);
		const hasUrl = signs && (text.includes("://") || text.includes("www."));
		let scanned = from;
		let wordStart = from;
		// The next bare URL start; outside link text, its URL is literal.
		let nextUrl = hasUrl || (signs && text.includes("@")) ? urlStart(text, from) : -1;
		const inUrl = (p: number) => {
			if (!hasUrl) return false;
			for (; scanned < p; scanned++) if (SPACE.test(text[scanned])) wordStart = scanned + 1;
			const word = text.slice(wordStart, p);
			return word.includes("://") || word.startsWith("www.");
		};
		// Whether the innermost open "[" closes into a link after index from (a bare URL there is no link for pi):
		// "link" when sure, "maybe" when the reader cannot prove it either way (both readings are then protected).
		const formsLink = (from: number): "link" | "maybe" | "none" => {
			const label = opens[opens.length - 1];
			for (let q = from, depth = 0; q < text.length; q++) {
				const ch = text[q];
				if (ch === "\\") q++;
				else if (ch === "[") depth++;
				else if (ch === "]" && depth > 0) depth--;
				else if (ch === "]") {
					if (label.dead) return "none";
					// A target that does not close on this line may close on a later one.
					if (text[q + 1] === "(") return linkTargetEnd(text, q + 1) > 0 ? "link" : "maybe";
					// A full or collapsed reference may be a link only when its label may be defined (labelsOf is loose).
					const close = text[q + 1] === "[" ? labelEnd(text, q + 2) : -1;
					if (close >= 0) {
						const ref = text.slice(q + 2, close);
						return isDefined(ref.trim() ? ref : text.slice(label.at + 1, q)) ? "maybe" : "none";
					}
					if (text[q + 1] === "[" && !hasBareBracket(text.slice(q + 2))) return "maybe";
					return isDefined(text.slice(label.at + 1, q)) ? "maybe" : "none";
				}
			}
			return "none";
		};
		// The first special character at or after the last search start (text.length for none). p only grows, so it
		// stays the next one until p passes it: each line is searched once, however many URLs it holds.
		let nextSpecial = -1;
		for (let p = from; p < text.length; ) {
			// Jump to the next character that may open a code span, a comment, math, an escape or a construct.
			if (nextUrl >= 0 && nextUrl < p) nextUrl = urlStart(text, p);
			if (nextSpecial < p) {
				SPECIAL.lastIndex = p;
				nextSpecial = SPECIAL.exec(text)?.index ?? text.length;
			}
			p = nextSpecial;
			if (nextUrl >= 0 && nextUrl < p) p = nextUrl;
			if (p >= text.length) break;
			if (p === nextUrl) {
				// pi links no bare URL inside the text of a link. When the reader cannot prove that link, it protects
				// the URL and reads on inside it, so the possible link is protected too.
				const form = opens.length > 0 ? formsLink(p) : "none";
				const end = !asWritten() && form !== "link" ? urlEnd(text, p) : -1;
				if (end > p) literal.push([p, end]);
				if (form === "maybe") {
					nextUrl = urlStart(text, ++p);
					continue;
				}
				// A failed email candidate is skipped up to its "@", so the search stays linear.
				EMAIL_HEAD.lastIndex = p;
				p = end > p ? end : EMAIL_HEAD.test(text) && EMAIL_HEAD.lastIndex > p ? EMAIL_HEAD.lastIndex : p + 1;
				nextUrl = urlStart(text, p);
				continue;
			}
			const c = text[p];
			if (c === "[" || c === "]" || c === "(" || c === ")" || c === ">") {
				if (c === "[") {
					// marked's link text holds brackets one level deep: a "[" two levels in ("[a [[Done]]](/x)") leaves
					// the outer text no link.
					// Such text keeps the link's shape, and a pill drawn in it would make its escapes a link: it is left
					// as written too, but marks no link around it as dead.
					if (opens.length >= 2) opens[opens.length - 2].deep = true;
					opens.push({ at: p, image: text[p - 1] === "!" && !escapedAt(text, p - 1), dead: false, deep: false });
				}
				else if (c === "]") {
					// A link is drawn by pi as a whole: its text, destination and title stay literal (a pill or bold in
					// link text would break the link).
					const label = opens.pop();
					if (label && !label.dead && !asWritten()) {
						let end: [number, number] | undefined;
						if (text[p + 1] === "(") {
							end = targetEnd(i, p + 1, multiline);
							// Link-shaped text whose target the reader cannot read: a pill's escapes there may make a link or
							// change how pi reads the text after it, so it is left as written up to the first ")".
							if (!end) {
								const close = text.indexOf(")", p + 2);
								literal.push([label.image ? label.at - 1 : label.at, close > 0 ? close + 1 : p + 2]);
							}
						}
						else if (text[p + 1] === "[") {
							// A full reference link [text][ref] or a collapsed one [ref][].
							const close = labelEnd(text, p + 2);
							const ref = close > 0 ? text.slice(p + 2, close) : undefined;
							if (ref !== undefined && isDefined(ref.trim() ? ref : text.slice(label.at + 1, p))) end = [i, close + 1];
							else if (close < 0 && multiline && i + 1 < lines.length && lines[i + 1].trim() && !hasBareBracket(text.slice(p + 2))) {
								// The reference ID may go on over the next line of the paragraph.
								const next = lines[i + 1];
								const tail = labelEnd(next, 0);
								see(i + 1);
								if (tail >= 0 && isDefined(text.slice(p + 2) + "\n" + next.slice(0, tail))) end = [i + 1, tail + 1];
							}
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
			// In HTML text a backslash escapes nothing: pi-tui hides a comment after it too.
			if (c === "\\" && htmlShown && text[p + 1] === "<") {
				p++;
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
			// pi shows an HTML block's text as written: a backtick there opens no code span.
			if (!comment && htmlShown) {
				p = q;
				continue;
			}
			const ender = comment ? "-->" : text.slice(p, q);
			const find = (s: string, from: number) => (comment ? s.indexOf("-->", from) : backtickRun(s, from, q - p));
			const close = find(text, comment ? p + 4 : q);
			if (close >= 0) {
				literal.push([p, close + ender.length]);
				p = close + ender.length;
				continue;
			}
			// In an HTML block that goes on after this line, the comment is a block state (rawOpen): the lines up
			// to its end are read there.
			if (comment && htmlShown && htmlShow !== false) {
				literal.push([p, text.length]);
				break;
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
			// In an HTML block of types 1, 3-5, which holds blank lines, pi hides the comment up to its "-->" or
			// the block's end marker, over blank lines: those lines are literal.
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
	/** The current top-level line ends its HTML or comment block for sure: the next line starts a new block. */
	const endTopBlock = (i: number) => {
		blockEnd = i;
		htmlEnd = undefined;
		htmlFlow = false;
		htmlParagraph = false;
	};
	const push = (line: ReadLine, i: number) => {
		if (line.kind !== "prose") {
			pendingMath = false;
			inlineCarry = false;
		}
		if (line.kind !== "prose" && line.kind !== "heading" && literalUntil?.line === i) literalUntil = undefined;
		if (rawOpen?.line === i && line.kind !== "code" && line.kind !== "blank") line = { ...line, literal: mergeRanges([...line.literal, [rawOpen.at, lines[i].length]]) };
		read.push(line);
	};

	for (let i = 0; i < lines.length; i++) {
		// After pending display math pi shows every line as written: prose, nothing literal.
		if (writtenFrom >= 0) {
			push(lines[i].trim() ? { kind: "prose", literal: [], plain: false } : { kind: "blank", literal: [], plain: false }, i);
			continue;
		}
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
		const inHtml = htmlEnd !== undefined || htmlFlow || htmlShow !== false;
		if (htmlEnd && htmlEnd.test(lines[i])) {
			htmlEnd = undefined;
			htmlClosedAt = i;
		}
		const { depth, indent, body, lead } = blockOf(lines[i]);
		// A paragraph was open before this line (a quote's paragraph takes a lazy line that opens no block).
		const wasParagraph = paragraph;
		/**
		 * This line leaves the container of a fence or a block comment opened on line s.line: the line is then
		 * read anew. Leaving a block quote ends it. In a list item, pi's parser (marked) keeps a plain text line
		 * that is indented less (a lazy line), so only a line that opens a block (a fence, a heading, HTML, a quote,
		 * a list item, a thematic break) ends the item, or any such line after a blank line, an opening fence, a
		 * heading, a thematic break or a line indented 4 more than the item's content.
		 */
		const leftContainer = (s: { depth: number; base: number; line: number; item: number; onMarker: boolean; lazy?: boolean }, opensFence: boolean) => {
			/** The list item with content column base ends at this line, which is indented less. */
			const itemEnds = (base: number, quotes: number) => {
				const l = Math.min(3, base - 1);
				if (indent <= l && (ITEM_BREAK.test(body) || thematicBreak(body))) return true;
				// The line before, as marked sees it: its text after the item's content column (also for a lazy line
				// indented less). On the line of the item's marker it is the text after the marker, spaces included.
				const full = afterQuotes(lines[i - 1], quotes);
				return endsItemAfter(full, i - 1 === s.line && s.onMarker ? afterMarker(full) : full.slice(base), base);
			};
			if (depth < s.depth) {
				// A block in a list item in a quote: the quote takes a lazy line (one that opens no block), and the item
				// keeps it by marked's list rule (itemEnds). A block directly in a quote ends with it.
				// (Observed in pi: a quoted line with trailing white space before it ends the lazy line's reading, and
				// the next quoted line after a lazy line leaves the block.)
				if (s.base > 0) {
					if (!body.trim() || INTERRUPT.test(body) || thematicBreak(body) || /[ \t]$/.test(lines[i - 1]) || itemEnds(s.base, s.depth)) return true;
					s.lazy = true;
					return false;
				}
				// A block in a quote that is in a list item: pi's list item may take the line after the quote (lazily or
				// indented), and with it the block. The reader keeps the line in the block until the item ends (where
				// pi ends the quote's block instead, this is over-protection).
				if (s.item === 0) return true;
				if (!body.trim()) return false;
				if (indent >= s.item) return false;
				return itemEnds(s.item, 0);
			}
			if (s.lazy) return true;
			if (depth > s.depth && lead < s.base) return true;
			if (!(s.base > 0 && body.trim() !== "" && indent < s.base)) return false;
			return itemEnds(s.base, s.depth);
		};
		if (fence) {
			if (!leftContainer(fence, true)) {
				if (depth === fence.depth && indent - fence.base <= 3 && closesFence(body, fence.char, fence.length)) {
					// After a fence the reader may have opened in HTML text (chain), pi may open a fence on this line.
					const again = fence.chain ? body.match(FENCE_OPEN) : null;
					if (again && !(again[1][0] === "\x60" && again[2].includes("\x60"))) fence = { ...fence, char: again[1][0], length: again[1].length, line: i };
					else {
						fence = undefined;
						// A top-level fence's closing line ends its block for sure: the next line may open math.
						if (depth === 0 && listColumns.length === 0) blockEnd = i;
					}
				}
				push(code, i);
				continue;
			}
			leftBase = fence.base;
			// (A fence in a list item in a quote: pi keeps the next line in the quote lazily.)
			if (depth < fence.depth && fence.base > 0) leftQuoteAt = i;
			fence = undefined;
			leftAt = i;
			// Left after a blank line: the block surely ended there (the next block may be math).
			if (depth === 0 && !lines[i - 1].trim()) blockEnd = i - 1;
		}
		if (comment) {
			if (!leftContainer(comment, false)) {
				// A comment in an HTML block of types 1, 3-5 ends with the block: pi hides it up to the block's end.
				const marker = comment.html instanceof RegExp ? lines[i].search(comment.html) : -1;
				const close = lines[i].indexOf("-->");
				if (marker >= 0 && htmlShow === comment.html) {
					htmlShow = false;
					htmlShownEnd = i;
				}
				if (marker >= 0 && itemHtml?.end === comment.html) itemHtml = undefined;
				if (comment.html === "flow" && itemHtml?.end === "flow" && !body.trim()) itemHtml = undefined;
				// A comment in an HTML block of type 6 or 7 ends at its blank line (marked's: spaces and tabs only),
				// which the blank line branch reads.
				if (comment.html === "flow" && /^[ \t]*$/.test(lines[i])) comment = undefined;
				else if (comment.html !== false && close >= 0) {
					// pi-tui hides each comment of the HTML block's text: after this one's end the text shows, up to
					// the next comment, which may go on over the next lines. On the block's last line (its end marker
					// before or after the "-->") the HTML token ends with the line: a later comment ends there too.
					comment = marker < 0 && commentOpenAt(lines[i], close + 3) >= 0 ? comment : undefined;
					htmlShown = true;
					push({ kind: "prose", literal: mergeRanges([[0, close + 3], ...inline(i, close + 3, false)]), plain: false }, i);
					// The HTML token's last line at top level: the next line starts a new block.
					if (marker >= 0 && depth === 0 && listColumns.length === 0 && htmlShownEnd === i) {
						endTopBlock(i);
						paragraph = false;
					}
					continue;
				} else {
					if (marker >= 0 || close >= 0) {
						// A top-level comment block (or the HTML block it is in) ends with its line: the next line starts a
						// new block.
						if (comment.depth === 0 && comment.base === 0 && depth === 0 && listColumns.length === 0) endTopBlock(i);
						comment = undefined;
					}
					push(code, i);
					continue;
				}
			} else {
				comment = undefined;
				if (depth === 0 && !lines[i - 1].trim()) blockEnd = i - 1;
			}
		}
		if (itemHtml && (leftContainer(itemHtml, false) || (itemHtml.end === "flow" && !body.trim()))) itemHtml = undefined;
		// This line is HTML text of a container's HTML block (its end marker's line too).
		const itemHtmlLine = itemHtml !== undefined;
		if (itemHtml?.end instanceof RegExp && itemHtml.end.test(lines[i])) itemHtml = undefined;
		if (indentedBase !== undefined) {
			if (!body.trim() || indent >= indentedBase + 4) {
				// In a list item the reader lost, pi may read the line as the item's fence: the reader opens one
				// that each closing line opens again (the lines stay code either way).
				// The line may end the HTML block the code sits in (pi reads it as HTML text).
				if (htmlShow instanceof RegExp && htmlShow.test(lines[i])) {
					htmlShow = false;
					htmlShownEnd = i;
				} else if (htmlShow === "flow" && /^[ \t]*$/.test(lines[i])) htmlShow = false;
				// In the HTML block pi shows this line as HTML text: a comment that opens on it goes on.
				if (htmlShow !== false && !comment && commentOpenAt(lines[i], 0) >= 0) comment = { depth: 0, base: 0, line: i, item: 0, onMarker: false, html: htmlShow };
				const again = lostItem > 0 && indent - lostItem <= 3 ? body.match(FENCE_OPEN) : null;
				if (again && !(again[1][0] === "\x60" && again[2].includes("\x60"))) {
					fence = { char: again[1][0], length: again[1].length, base: 0, depth, line: i, chain: true, item: 0, onMarker: false };
					indentedBase = undefined;
				}
				push(code, i);
				continue;
			}
			// A top-level indented code block ends for sure at a line indented less: the next block may be math.
			if (indentedBase === 0 && depth === 0 && previousDepth === 0 && listColumns.length === 0) blockEnd = i - 1;
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
			// pi's list item may go on around a quote (a quote in the item, or lines after it): the reader does
			// not follow it, so fences read while unsure follow lostItem.
			// (A line indented less than the item's content after a blank line, or one that opens a quote there, ends it.)
			const column = listColumns.at(-1) ?? 0;
			if (column > 0 && !(lead < column && (read[i - 1]?.kind === "blank" || depth > previousDepth))) lostItem = Math.max(lostItem, column);
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
			// Types 1 and 3-5 hold blank lines; types 6 and 7 end at one.
			// (marked's blank line holds spaces and tabs only: a no-break space line is HTML text.)
			if (htmlShow === "flow" && /^[ \t]*$/.test(lines[i])) htmlShow = false;
			push({ kind: "blank", literal: [], plain: false }, i);
			const clean = !fence && indentedBase === undefined && !paragraph && !emptyItem && previousDepth === 0 && listColumns.length === 0;
			// A definition gives meaning to reference links before it, so no head holds one.
			// Lines are checked for a definition only up to a candidate boundary, each once.
			if (clean && !definitionSeen && definitions) for (; definitionChecked < i && !definitionSeen; definitionChecked++) definitionSeen = mayDefine(lines[definitionChecked]);
			if (clean && !definitionSeen && seen <= i && !containerMath && !mathOff && !pendingMath && !inlineCarry && !htmlParagraph && literalUntil === undefined && !discovering && !htmlEnd && htmlShow === false && lostItem === 0 && lazyItem === 0 && itemHtml === undefined) boundary = i;
			continue;
		}
		// A lost list item surely ended: a top-level line indented less after a blank line, or one that opens a block.
		if ((lostItem || lazyItem) && depth === 0 && !lazy && (read[i - 1]?.kind === "blank" || INTERRUPT.test(body) || breakLine)) {
			if (indent < lostItem) lostItem = 0;
			if (indent < lazyItem) lazyItem = 0;
		}
		// This line is in the HTML block of the lines before it; the end marker's line is the block's last.
		htmlShown = htmlShow !== false;
		if (htmlShow instanceof RegExp && htmlShow.test(lines[i])) {
			htmlShow = false;
			htmlShownEnd = i;
		}
		// pi-tui hides each comment in an HTML block's text, whatever Markdown the line holds (a heading, a code
		// span): a comment that does not end on this line goes on to its end or to the block's end.
		if (((htmlShown && htmlShow !== false) || itemHtml) && !body.startsWith("<!--")) {
			const at = commentOpenAt(lines[i], 0);
			if (at >= 0) {
				comment = itemHtml && !htmlShown ? { depth: itemHtml.depth, base: itemHtml.base, line: i, item: itemHtml.item, onMarker: false, html: itemHtml.end } : { depth: 0, base: 0, line: i, item: 0, onMarker: false, html: htmlShow };
				rawOpen = { line: i, at };
			}
		}
		// After a blank line, a line indented less than a list item's content ends that item.
		// Any other line indented less than an item's content, except a lazy paragraph line, ends it too.
		if (containerMath && depth === 0 && read[i - 1]?.kind === "blank" && (listColumns.length === 0 || indent < listColumns[0])) containerMath = false;
		const columns = listColumns.length;
		// marked ends a list item at a line indented less than its content when the line before (its text after
		// the content column, or after the item's marker) is indented 4 more than that content or starts with a
		// fence run, "#" or a thematic break: the line opens a new paragraph after the list.
		if (paragraph && !opensBlock && depth === previousDepth && columns > 0 && indent < listColumns[columns - 1] && read[i - 1]?.kind === "prose") {
			const column = listColumns[columns - 1];
			const full = afterQuotes(lines[i - 1], depth);
			const item = blockOf(lines[i - 1]).body.match(LIST_MARKER);
			if (endsItemAfter(full, item ? afterMarker(full) : full.slice(column), column)) paragraph = false;
		}
		// A line that left a fence in a nested list item may stay lazily in an outer item for pi: the reader
		// stops following that item (lostItem).
		const mayStay = leftAt === i && !opensBlock && read[i - 1]?.kind !== "blank";
		if (!paragraph || opensBlock || /^(?:=+|-+) *$/.test(body))
			while (listColumns.length && listColumns[listColumns.length - 1] > indent) {
				const column = listColumns.pop()!;
				if (mayStay && column < leftBase) lazyItem = lazyItem ? Math.min(lazyItem, column) : column;
			}
		const base = listColumns.at(-1) ?? 0;
		// In a list item the reader lost, the line may be the item's text for pi (and open a fence after it).
		if (!paragraph && indent >= base + 4 && !(lazyItem > 0 && indent - lazyItem < 4)) {
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
			let title = listColumns.length === columns && !htmlParagraph && (paragraphColumn === 0 || indent >= paragraphColumn) && paragraphStart !== leftQuoteAt;
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
			// In an HTML block a list marker is HTML text: it opens no list item.
			const m = htmlShown || (content === body ? breakLine : thematicBreak(content)) ? null : content.match(LIST_MARKER);
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
		if (mathMark && mathEnd < 0 && depth + innerDepth === 0 && !marker && listColumns.length === 0) {
			mathOff = true;
			// pi-tui's pending display math (its tokenizeBlockLatex): the rest of the reply, shown as written.
			const rest = [content.replace(/^(?:\$\$|\\\[)[ \t]*/, ""), ...lines.slice(i + 1)].join("\n").replace(/^\n/, "");
			if (mathEnd === PENDING && rest && (content[0] === "\\" || PENDING_MATH.test(rest)) && !hasTableStart(rest)) writtenFrom = i;
		}
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
		// In an HTML block pi shows a fence's opening line as HTML text. In a list item the reader lost, it opens a
		// fence that each closing line opens again. (In a container's HTML block it reads fences as pi reads them
		// outside HTML: a documented limit.)
		const lost = Math.max(lostItem, lazyItem);
		if (open && !htmlShown && !itemHtmlLine && (marker || innerDepth > 0 || indent - base <= 3 || (lost > 0 && indent - lost <= 3)) && !(open[1][0] === "\x60" && open[2].includes("\x60"))) {
			const chain = lost > 0;
			fence = { char: open[1][0], length: open[1].length, base: innerDepth ? 0 : contentBase, depth: depth + innerDepth, line: i, chain, item: listColumns.at(-1) ?? 0, onMarker: marker && innerDepth === 0 };
			if (depth + innerDepth === 0 && !marker && listColumns.length === 0 && !inHtml && !htmlShown && !htmlParagraph && !mathOff && !pendingMath && !containerMath)
				sureFences.push({ start: i + 1, char: fence.char, length: fence.length });
			paragraph = false;
			push(code, i);
			continue;
		}
		// An HTML comment that opens a line is an HTML block up to the whole line that ends it (marked's
		// "comment[^\n]*\n"; "<!-->" and "<!--->" end at once), or up to the end of its container or of the HTML
		// block it is in. Text after its end on the same line is read as code (pi shows it: over-protection).
		if (content.startsWith("<!--")) {
			paragraph = false;
			push(code, i);
			// In an HTML block pi-tui hides the comment up to "-->" after "<!--" only.
			// A second comment may open after the first one's end. In an HTML block pi-tui hides each comment up to
			// "-->" after "<!--", or to the block's end.
			const ended = htmlShown ? htmlShow === false || commentOpenAt(content, 0) < 0 : itemHtmlLine ? itemHtml === undefined || commentOpenAt(content, 0) < 0 : /^<!--(?:-?>|[\s\S]*?-->)/.test(content);
			// In an HTML block quote and list markers are HTML text: the comment has no container there.
			if (!ended && htmlShown) comment = { depth: 0, base: 0, line: i, item: 0, onMarker: false, html: htmlShow };
			else if (!ended && itemHtml) comment = { depth: itemHtml.depth, base: itemHtml.base, line: i, item: itemHtml.item, onMarker: false, html: itemHtml.end };
			else if (!ended) comment = { depth: depth + innerDepth, base: innerDepth ? 0 : contentBase, line: i, item: listColumns.at(-1) ?? 0, onMarker: false, html: false };
			// A top-level comment block (or the HTML block it is in) that ends on its line: the next line starts a new
			// block (math may open).
			else if ((!htmlShown || htmlShownEnd === i) && depth + innerDepth === 0 && !marker && listColumns.length === 0) endTopBlock(i);
			continue;
		}
		// A link reference definition, outside a paragraph (a new list item or quote opens none): pi shows none
		// of it. Its destination and title may go on over the next lines of the same quote depth.
		// The label may go on over the next lines: a first line with no "]" may open one.
		if ((!paragraph || newItem || innerDepth > 0) && !lazy && !mathOff && !containerMath && !htmlParagraph && content[0] === "[" && (content.includes("]:") || bareBracketAt(content.slice(1)) < 0)) {
			let joined = content;
			let k = i + 1;
			for (let limit = i + 8; k < lines.length && k <= limit; k++) {
				// A top-level definition is marked's rule over the raw lines: its label may hold any line, a blank
				// one too, up to its "]" (with no line limit: the destination and title then get 8 more lines).
				if (depth === 0 && !marker && bareBracketAt(joined.slice(1)) < 0) {
					joined += "\n" + lines[k].replace(/\t/g, "   ");
					limit = k + 8;
					continue;
				}
				const next = blockOf(lines[k]);
				if (!next.body.trim() || next.depth !== depth) break;
				joined += "\n" + next.body;
			}
			const m = joined.match(DEFINITION);
			// A label that opens on this line and closes with "]:" on a later one, which the reader cannot read
			// exactly (in a container, or over quote markers): its lines are protected as if pi hid them, with a
			// destination and title on the next lines.
			let unsure = -1;
			if (!m && bareBracketAt(content.slice(1)) < 0) {
				let c = i + 1;
				while (c < lines.length && !hasBareBracket(lines[c])) c++;
				const at = c < lines.length ? bareBracketAt(lines[c]) : -1;
				if (at >= 0 && lines[c].startsWith("]:", at)) {
					unsure = c;
					const after = lines[c].slice(at + 2).trim();
					const title = (t: number) => t < lines.length && /^[ \t>]*["'(]/.test(lines[t]);
					if (c + 1 < lines.length && lines[c + 1].trim() && (!after || title(c + 1))) unsure = c + 1;
					if (!after && unsure === c + 1 && title(c + 2)) unsure = c + 2;
				}
			}
			if (m || unsure >= 0) {
				const last = m ? i + (m[0].match(/\n/g)?.length ?? 0) : unsure;
				see(Math.max(Math.min(k, lines.length - 1), last));
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
			// The last line of a top-level HTML block of types 1, 3-5: the next line starts a new block.
			if (htmlShownEnd === i && plain) endTopBlock(i);
			continue;
		}
		// An empty list item holds no paragraph yet.
		// An HTML block (such as "<div>") may also interrupt a paragraph.
		// Link protection is off only where the reader is sure that pi shows an HTML block as written: at top level
		// (no quote, no list), as marked's html rule reads it. Elsewhere links stay protected (at worst a pill pi
		// shows in HTML text is left as written).
		// (After pending math pi shows the rest as written: no HTML block opens.)
		if (content.startsWith("<") && !htmlShown && plain && !lazy && content === body && !mathOff) {
			// After an HTML block of types 1, 3-5 closed on the line before, this line starts a new block. Types 3-5
			// and 7 interrupt no paragraph, also not a quote's paragraph that the line continues lazily.
			const fresh = !wasParagraph || htmlShownEnd === i - 1;
			// Only types 1 and 6 interrupt a paragraph, and only from the line's first column (marked's paragraph rule).
			const interrupts = fresh || lines[i][0] === "<";
			// marked reads each opener with the line break after it: the reply's last line has none.
			const line = i < lines.length - 1 ? content + "\n" : content;
			const raw = HTML_RAW.exec(line);
			const until = raw ? undefined : HTML_UNTIL.slice(1).find(([opens]) => opens.test(content));
			// marked's paragraph interrupt is case-sensitive: "<PRE>" or "<DIV>" in a paragraph is paragraph text.
			if (raw && interrupts && (fresh || /^<(?:script|pre|style|textarea)/.test(content))) {
				// Type 1 ends at the closing tag of its own opener.
				const end = new RegExp("</" + raw[1] + ">", "i");
				htmlShown = true;
				htmlShow = end.test(content.slice(raw[0].length)) ? false : end;
				if (htmlShow === false) htmlShownEnd = i;
			} else if (until && fresh) {
				htmlShown = true;
				htmlShow = until[1].test(content.slice(2)) ? false : until[1];
				if (htmlShow === false) htmlShownEnd = i;
			} else if ((interrupts && (fresh ? HTML_FLOW_LINE : HTML_FLOW_LINE_CASED).test(line)) || (fresh && HTML_TAG_LINE.test(content))) {
				htmlShown = true;
				htmlShow = "flow";
			}
			// A comment that opens on the HTML block's opening line and does not end on it goes on in the block.
			if (htmlShown && htmlShow !== false && !comment) {
				const at = commentOpenAt(lines[i], 0);
				if (at >= 0) {
					comment = { depth: 0, base: 0, line: i, item: 0, onMarker: false, html: htmlShow };
					rawOpen = { line: i, at };
				}
			}
		}
		if (content.startsWith("<") && !plain && !itemHtmlLine && (!wasParagraph || newItem || innerDepth > 0)) {
			const line = i < lines.length - 1 ? content + "\n" : content;
			const raw = HTML_RAW.exec(line);
			const until = raw ? undefined : HTML_UNTIL.slice(1).find(([opens]) => opens.test(content));
			let end: RegExp | "flow" | undefined;
			if (raw) {
				const close = new RegExp("</" + raw[1] + ">", "i");
				end = close.test(content.slice(raw[0].length)) ? undefined : close;
			} else if (until) end = until[1].test(content.slice(2)) ? undefined : until[1];
			else if (HTML_FLOW_LINE.test(line) || HTML_TAG_LINE.test(content)) end = "flow";
			if (end) itemHtml = { depth: depth + innerDepth, base: innerDepth ? 0 : contentBase, line: i, item: listColumns.at(-1) ?? 0, onMarker: marker && innerDepth === 0, end };
		}
		if (content.startsWith("<")) {
			htmlParagraph = true;
			// In a paragraph only type 1 interrupts (case-sensitive, from the first column, marked's paragraph rule).
			const starts = !wasParagraph || htmlShownEnd === i - 1 || (lines[i][0] === "<" && /^<(?:script|pre|style|textarea)/.test(content));
			const kind = plain && !lazy && !inHtml && starts ? HTML_UNTIL.find(([opens]) => opens.test(content)) : undefined;
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
		// An HTML block of types 1, 3-5 that ends on this top-level line ends its block: the next line starts a new
		// one (indented code or display math may open).
		if (htmlShownEnd === i && plain && !lazy) {
			paragraph = false;
			htmlParagraph = false;
			blockEnd = i;
		}
	}
	// The reply ends where pi's parser keeps the next line in the same block: an open top-level HTML block of
	// types 1, 3-5, or display math that pi shows as math or as written up to the reply's end.
	const open = htmlEnd !== undefined || mathOff;
	// After the closing line of an HTML block of types 1, 3-5 pi starts a new block: the text there is not HTML.
	const htmlText = htmlParagraph && !(htmlClosedAt >= 0 && htmlClosedAt < lines.length - 1);
	// A label the reading took as defined whose only defining lines are inside a sure fence.
	const fencedOnly = !skipFenced && sureFences.length > 0 && [...consulted].some((key) => defined!.get(key)!.every((j) => inSureFence(lines, sureFences, j)));
	return { read, boundary, end: { open, literal: open || htmlText || pendingMath || containerMath || literalUntil !== undefined }, fencedOnly, sureFences };
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

// marked's type 1 opener: the tag and the space, line break or ">" after it.
const HTML_RAW = /^<(pre|script|style|textarea)[\s>]/i;
// CommonMark HTML block type 7 (marked's html rule): an open or closing tag alone on its line.
const HTML_TAG_LINE = /^(?:<(?!script|pre|style|textarea)[a-z][\w-]*(?: +[a-z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>\x60]+)?)*? *\/?>|<\/(?!script|pre|style|textarea)[a-z][\w-]*\s*>)[ \t]*$/i;
// CommonMark HTML block type 6 (marked's tag list): it ends at a blank line and may interrupt a paragraph.
const HTML_FLOW = /^<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|\/?>|$)/i;

// marked's type 6 opener: the tag, then spaces, a line break or ">" (HTML_FLOW reads any white space there).
const HTML_FLOW_LINE = new RegExp(HTML_FLOW.source.replace("(?:\\s|\\/?>|$)", "(?: +|\\n|\\/?>)"), "i");
// marked's paragraph interrupt for type 6: the same tags, case-sensitive.
const HTML_FLOW_LINE_CASED = new RegExp(HTML_FLOW_LINE.source);

/** The column of a comment that opens in text from "from" on and does not end on the line (pi-tui's comment scan), or -1. */
function commentOpenAt(text: string, from: number): number {
	for (let p = from; ; ) {
		const open = text.indexOf("<!--", p);
		if (open < 0) return -1;
		const close = text.indexOf("-->", open + 4);
		if (close < 0) return open;
		p = close + 3;
	}
}

/** Line k opens a display math block that pi's parser takes: closed, or pending with math in it. */
function opensMathBlock(lines: string[], k: number, see: (k: number) => void): boolean {
	const content = lines[k].replace(/^ {0,3}/, "");
	if (!(content.startsWith("$$") || content.startsWith("\\["))) return false;
	const end = mathBlockEnd(lines, k, content);
	see(end >= 0 ? end : lines.length);
	if (end >= 0 || content[0] === "\\") return true;
	return PENDING_MATH.test([content.slice(2), ...lines.slice(k + 1)].join("\n"));
}

/** line with its first "quotes" block quote markers removed and tabs as three spaces (pi's tab replacement). */
function afterQuotes(line: string, quotes: number): string {
	let rest = line.replace(/\t/g, "   ");
	for (let d = 0; d < quotes; d++) {
		const q = rest.match(QUOTE);
		if (!q) break;
		rest = rest.slice(q[0].length);
	}
	return rest;
}
/** The text after the last list marker that opens full, spaces included (marked's text of the innermost item's marker line). */
function afterMarker(full: string): string {
	let at = full.search(/\S/);
	for (;;) {
		const m = full.slice(at).match(LIST_MARKER);
		if (!m) return full.slice(at);
		const after = at + m[1].length;
		const next = full.slice(after).search(/\S/);
		if (next < 0 || !LIST_MARKER.test(full.slice(after + next))) return full.slice(after);
		at = after + next;
	}
}
/**
 * marked's list rule: a line indented less than an item's content (column) ends the item when the line before
 * (full, after its quote markers; h, its text after the content column) is blank, is indented 4 more, or starts
 * with a fence run, "#" or a thematic break.
 */
function endsItemAfter(full: string, h: string, column: number): boolean {
	if (!full.trim()) return true;
	const lead = h.search(/\S/);
	if (lead >= 4) return true;
	const l = Math.min(3, column - 1);
	return new RegExp(`^ {0,${l}}(?:\x60\x60\x60|~~~|#)`).test(h) || (lead >= 0 && lead <= l && thematicBreak(h.slice(lead).trimEnd()));
}

/** text holds a table start (pi-tui's containsTableStart): a row with "|" over a delimiter row. */
function hasTableStart(text: string): boolean {
	const rows = text.split("\n");
	for (let r = 0; r + 1 < rows.length; r++) if ((rows[r + 1].includes("|") || rows[r].includes("|")) && TABLE_DELIMITER.test(rows[r + 1])) return true;
	return false;
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
// Their MIT notices: THIRD-PARTY-NOTICES.md.
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
// (Numbered groups, not named ones: a match of a regex with named groups builds a groups object.)
const BLOCK_SKIP = /\[(?:[^\[\]\x60]|(\x60+)[^\x60]+\1(?!\x60))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)|(?<!\x60)()(\x60+)[^\x60]+\3(?!\x60)|<(?! )[^<>]*?>/g;
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
/** The length of marked's gfm url token at index at of text (its email or backpedaled URL), 0 for none. */
function gfmUrlLength(text: string, at: number): number {
	GFM_URL.lastIndex = at;
	const url = GFM_URL.exec(text);
	if (!url) return 0;
	let raw = url[0];
	if (url[2] !== "@") {
		let before: string;
		do {
			before = raw;
			raw = BACKPEDAL.exec(raw)?.[0] ?? "";
		} while (before !== raw);
	}
	return raw.length;
}
/** pi's bare URL at index at (pi-tui's MarkdownTokenizer.url): marked's url token (URL before email), read again up to its first CJK punctuation; 0 for none. */
function piUrlLength(text: string, at: number): number {
	const length = gfmUrlLength(text, at);
	const cut = length > 0 ? text.slice(at, at + length).search(CJK_PUNCTUATION) : -1;
	return cut < 0 ? length : gfmUrlLength(text.slice(at, at + cut), 0);
}
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

/**
 * Whether marked-cjk-friendly's emStrong accepts the delimiter run as an opener before it scans for a closer, with
 * prev the character before the run and next the character after it.
 */
const opensLeftMemo = new Map<string, boolean>();
export function opensLeft(prev: string, run: string, next: string): boolean {
	// The lengths make the key unambiguous; like runKind's memo, it stays small (short keys, cleared at 4096).
	const key = prev.length + "," + run.length + ":" + prev + run + next;
	let opens = opensLeftMemo.get(key);
	if (opens === undefined) {
		if (opensLeftMemo.size > 4096) opensLeftMemo.clear();
		opensLeftMemo.set(key, (opens = readOpensLeft(prev, run, next)));
	}
	return opens;
}
function readOpensLeft(prev: string, run: string, next: string): boolean {
	const text = run + next;
	L_DELIM.lastIndex = 0;
	const match = L_DELIM.exec(text);
	if (!match || !(match[1] || match[2] || match[3] || match[4])) return false;
	if (match[4] && ALPHANUMERIC.test(prev)) return false;
	const first = match[1] || match[3] || "";
	return !first || !prev || PUNCTUATION_BEFORE.test(prev) || PREV_CJK.test(prev) || CJK_CHAR.test(prev) || CJK_CHAR.test(first);
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
	const simple = simplePairs(text, literal);
	if (simple) return simple;
	const read: Lexed = { pairs: [], crossesLine: false, links: text.includes("](") };
	// The slow window: from the start of the word that holds the first URL_SIGN match to the start of the last one
	// (every match, overlapping ones too); empty (from > until) for none.
	const slow: Slow = { from: 0, until: -1 };
	URL_SIGNS.lastIndex = 0;
	for (let m: RegExpExecArray | null; (m = URL_SIGNS.exec(text)) !== null; URL_SIGNS.lastIndex = m.index + 1) {
		if (slow.until < 0) {
			let w = m.index;
			while (w > 0 && !SPACE.test(text[w - 1])) w--;
			slow.from = w;
		}
		slow.until = m.index;
	}
	lexInline(text, 0, text.length, literal, false, read, slow);
	return { pairs: read.pairs, crossesLine: read.crossesLine };
}

/** A sign that fast lexInline may read as a token other than text, "*" emphasis and literal ranges: escape, "_", strikethrough. */
const NOT_SIMPLE = /[\\_]|~~/;
/**
 * strongPairs for simple text, or undefined. Simple: no URL_SIGN, no NOT_SIMPLE sign and no "](" (so "[" is
 * text, and a lone "~" opens no strikethrough), every "*" run exactly "**" with ASCII characters (or the text's ends) around it and outside literal
 * ranges, and every run that the lexer tries as an opener finds its closer. lexInline then reads only "**"
 * tokens, literal ranges and fast text tokens, and emStrongAt reduces to this:
 * - The opener test reads the text (opensLeft is emStrongAt's test for an ASCII previous character). The
 *   previous character is the one before the run (a text token ends there), or none at the start of the read
 *   text or right after a literal range (no text token before it).
 * - The closer scan reads the masked text of the read text (BLOCK_SKIP only; no escape). FIRST_AST needs "__",
 *   so the scan is R_DELIM_AST_REST from the opener, and each of its capturing alternatives reads one character
 *   before the run and one after it, as runKind does; the masked text must keep every run.
 * - With every run of length 2 and the character before an opener never "*", a left-only run adds 2, a right or
 *   both-flanking run takes 2, and the run that brings the total to 0 closes a strong token.
 * An opener that fails would make the lexer try its second "*" alone: the full reading handles that.
 */
function simplePairs(text: string, literal: Range[]): { pairs: StrongPair[]; crossesLine: boolean } | undefined {
	if (NOT_SIMPLE.test(text) || text.includes("](") || URL_SIGN.test(text)) return undefined;
	const runs: number[] = [];
	for (let q = text.indexOf("*"); q >= 0; q = text.indexOf("*", q + 2)) {
		if (text[q + 1] !== "*" || text[q + 2] === "*" || text.charCodeAt(q - 1) >= 128 || text.charCodeAt(q + 2) >= 128) return undefined;
		runs.push(q);
	}
	const literalEnds = new Set<number>();
	for (const [s, e] of literal) {
		if (text.slice(s, e).includes("*")) return undefined;
		literalEnds.add(e);
	}
	const pairs: StrongPair[] = [];
	let crossesLine = false;
	// Reads runs a to b - 1, the runs of the text from..to; false when an opener fails.
	const read = (from: number, to: number, a: number, b: number): boolean => {
		if (a === b) return true;
		const part = text.slice(from, to);
		// lexInline's masked text, read without building it: each BLOCK_SKIP match becomes "[", then "a"s, then "]"
		// (every match is at least 2 long). Every "*" here is in a run; with no run inside a match, the masked
		// character before a run is "]" where a match ends right before it, and the one after it is "[" where a
		// match starts right after it; everywhere else it is the character of part.
		let skipStarts: Set<number> | undefined;
		let skipEnds: Set<number> | undefined;
		if (MAY_SKIP.test(part)) {
			BLOCK_SKIP.lastIndex = 0;
			for (let m: RegExpExecArray | null; (m = BLOCK_SKIP.exec(part)) !== null; ) {
				const end = m.index + m[0].length;
				if (m[0].includes("*")) return false;
				(skipStarts ??= new Set()).add(m.index);
				(skipEnds ??= new Set()).add(end);
			}
		}
		const before = (r: number) => (skipEnds?.has(r) ? "]" : part[r - 1]);
		const after = (r: number) => (r + 2 >= part.length ? "" : skipStarts?.has(r + 2) ? "[" : part[r + 2]);
		for (let k = a; k < b; ) {
			const q = runs[k];
			if (!opensLeft(q === from || literalEnds.has(q) ? "" : text[q - 1], "**", q + 2 < to ? text[q + 2] : "")) return false;
			let total = 2;
			let close = -1;
			for (let m = k + 1; m < b; m++) {
				const r = runs[m] - from;
				const kind = runKind(before(r), "**", after(r));
				if (kind === "none") continue;
				total += kind === "left" ? 2 : -2;
				if (total === 0) {
					close = m;
					break;
				}
			}
			if (close < 0) return false;
			const c = runs[close];
			pairs.push([q, c]);
			crossesLine ||= spans(text, q, c + 2);
			if (!read(q + 2, c, k + 1, close)) return false;
			k = close + 1;
		}
		return true;
	};
	return read(0, text.length, 0, runs.length) ? { pairs, crossesLine } : undefined;
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
const URL_SIGNS = new RegExp(URL_SIGN.source, "g");
/** The characters where a token other than text may start, without URLs: escape, link, emphasis, strikethrough. */
const NEXT_SIGN = /[\\\[!*_~]/g;

/**
 * slow: the window of all where a bare URL or email token may start. A token holds a URL_SIGN match at or after
 * its start and no white space, so it starts in the word of a match at or before the match: after the last
 * match and before the word of the first one none can start, and the text there is fast. A fast text token
 * before the window ends at its start (after white space, as a slow text token may end there too), so the slow
 * reading begins at the word with the previous character a slow reading would leave. Fast text is read as follows. Text tokens then matter only through the character before the next
 * escape, link, emphasis or strikethrough sign (the previous character pi's emphasis rule reads), so a text
 * token runs to the next such sign or literal range. Other stops of marked's text rule split text tokens
 * without changing that character, and a line break token leaves it whitespace or empty, which the emphasis
 * rule reads alike.
 */
const NO_EMPHASIS_SIGN = /[^*_]*/y;
/** Where strongPairs lexes slowly: from..until in the whole text (empty when from > until). */
interface Slow {
	from: number;
	until: number;
}
function lexInline(all: string, from: number, to: number, literal: Range[], inLink: boolean, read: Lexed, slow: Slow): void {
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
		const fast = from + i > slow.until || from + i < slow.from;
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
				lexInline(all, from + start, from + start + link[1].length, literal, true, read, slow);
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
				lexInline(all, from + i + width, from + token.end - width, literal, inLink, read, slow);
				i = token.end;
				continue;
			}
		}
		if (c === "~") {
			DEL.lastIndex = i;
			const del = DEL.exec(text);
			if (del) {
				read.crossesLine ||= spans(text, i, i + del[0].length);
				lexInline(all, from + i + 2, from + i + 2 + del[2].length, literal, inLink, read, slow);
				i += del[0].length;
				continue;
			}
		}
		if (fast) {
			let end = text.length;
			if (r < literal.length) end = Math.min(end, literal[r][0] - from);
			// Before the slow window, the token ends at its start.
			if (from + i < slow.from) end = Math.min(end, slow.from - from);
			// marked's text rule takes a run of tildes (an unmatched strikethrough) as one token.
			let next = i + 1;
			if (c === "~") while (text[next] === "~") next++;
			NEXT_SIGN.lastIndex = next;
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
			const length = piUrlLength(text, i);
			if (length > 0) {
				i += length;
				continue;
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
