// The block reader: the lines of a reply in; per line a kind, the literal ranges and the plain flag out;
// plus the place of the count line (countPlace).

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
// pi's display math block (pi-tui latexBlock): "$" or "\[" opening a block, up to the first "$" or "\]"
// that ends a line.
const MATH_MARKS = [
	{ open: /^\$\$[ \t]*/, close: /\$\$[ \t]*$/ },
	{ open: /^\\\[[ \t]*/, close: /\\\][ \t]*$/ },
];
const TABLE_DELIMITER = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
// A line that may end a paragraph and open another block: a code span reaching past it is uncertain.
const INTERRUPT = /^(?:\x60{3,}|~{3,}|#{1,6}(?: |$)|>|<|(?:[-*+]|\d{1,9}[.)])(?: |$))/;

/** A line as pi's parser sees its block: tabs as three spaces, block quote markers counted and removed. */
function blockOf(line: string): { depth: number; indent: number; body: string; lead: number } {
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

export function readMarkdown(lines: string[]): ReadLine[] {
	const read: ReadLine[] = [];
	let fence: { char: string; length: number; base: number; depth: number; line: number } | undefined;
	let indentedBase: number | undefined;
	let paragraph = false;
	let emptyItem = false;
	let previousDepth = 0;
	// Display math opens no block after an unclosed math mark (pi then shows the rest as written) or inside a
	// paragraph that opens with "<" (pi may read it as an HTML block up to a blank line).
	let mathOff = false;
	let htmlParagraph = false;
	// A code span or an HTML comment that may close on a later line: lines up to its end are literal, whichever way pi reads them.
	let literalUntil: { line: number; end: number; uncertain: boolean } | undefined;
	const untilNow = () => literalUntil;
	// Set while reading lines under an uncertain span the other way: spans found then are uncertain too.
	let discovering = false;
	const listColumns: number[] = [];
	const code: ReadLine = { kind: "code", literal: [], plain: false };

	// The literal ranges of line i from "from" on.
	const inline = (i: number, from: number, multiline: boolean): Range[] => {
		const text = lines[i];
		const literal: Range[] = from > 0 ? [[0, from]] : [];
		for (let p = from; p < text.length; ) {
			if (text[p] === "\\") {
				p += 2;
				continue;
			}
			const comment = text.startsWith("<!--", p);
			if (!comment && text[p] !== "\x60") {
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
		if (line.kind !== "prose" && line.kind !== "heading" && literalUntil?.line === i) literalUntil = undefined;
		read.push(line);
	};

	for (let i = 0; i < lines.length; i++) {
		const { depth, indent, body, lead } = blockOf(lines[i]);
		if (fence) {
			// A fence in a block quote or a list item ends with its container; the line is then read anew.
			// Leaving a block quote ends its fence. In a list item, pi's parser (marked) keeps a plain text line
			// that is indented less in the fence, so only a line that opens a block ends the item.
			const quoteOutside = depth > fence.depth && lead < fence.base;
			// marked ends the item also when the line before is the fence's opening line or indented 4 more.
			const previous = i - 1 === fence.line || blockOf(lines[i - 1]).indent - fence.base >= 4;
			const left = depth < fence.depth || quoteOutside || (fence.base > 0 && body.trim() !== "" && indent < fence.base && (previous || INTERRUPT.test(body)));
			if (!left) {
				const close = depth === fence.depth ? body.match(FENCE_CLOSE) : null;
				if (close && close[1][0] === fence.char && close[1].length >= fence.length && indent - fence.base <= 3) fence = undefined;
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
		const opensBlock = INTERRUPT.test(body) || THEMATIC_BREAK.test(body);
		const lazy = paragraph && depth < previousDepth && body.trim() !== "" && !opensBlock;
		if (depth !== previousDepth && !lazy) {
			paragraph = false;
			listColumns.length = 0;
		}
		if (!lazy) previousDepth = depth;
		if (!body.trim()) {
			// A list item that opens empty ends at a blank line.
			if (emptyItem) listColumns.pop();
			emptyItem = false;
			paragraph = false;
			htmlParagraph = false;
			push({ kind: "blank", literal: [], plain: false }, i);
			continue;
		}
		// After a blank line, a line indented less than a list item's content ends that item.
		// Any other line indented less than an item's content, except a lazy paragraph line, ends it too.
		if (!paragraph || opensBlock || /^(?:=+|-+) *$/.test(body)) while (listColumns.length && listColumns[listColumns.length - 1] > indent) listColumns.pop();
		const base = listColumns.at(-1) ?? 0;
		if (!paragraph && indent >= base + 4) {
			indentedBase = base;
			push(code, i);
			continue;
		}
		// A setext underline ends its paragraph.
		if (paragraph && /^(?:=+|-+) *$/.test(body)) {
			paragraph = false;
			push({ kind: "prose", literal: literalOf(i, false), plain: false }, i);
			continue;
		}
		if (THEMATIC_BREAK.test(body) && indent - base <= 3) {
			paragraph = false;
			push(code, i);
			continue;
		}
		let content = body;
		let contentBase = Math.min(base, indent);
		let marker = false;
		let itemCode = false;
		emptyItem = false;
		// List markers and, inside a list item, block quote markers, in any order. Four spaces after a quote
		// marker or five after a list marker open indented code.
		let innerDepth = 0;
		for (;;) {
			const m = THEMATIC_BREAK.test(content) ? null : content.match(LIST_MARKER);
			// The first item of a list interrupts a paragraph only when it is not empty and, if ordered, starts
			// at 1; pi's parser does not always hold to this. Such a line is read both ways: as an item for
			// what it opens on this line, as paragraph text for the lines after it.
			const ambiguous = m !== null && !marker && paragraph && (!content.slice(m[0].length).trim() || (/^\d/.test(m[1]) && Number.parseInt(m[1], 10) !== 1));
			if (m) {
				if (!marker) while (listColumns.length && listColumns[listColumns.length - 1] > indent) listColumns.pop();
				const start = marker ? contentBase : indent;
				const spaces = m[2].length;
				contentBase = start + m[1].length + (spaces >= 1 && spaces <= 4 ? spaces : 1);
				if (!ambiguous) listColumns.push(contentBase);
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
		const itemLazy = paragraph && !marker && innerDepth === 0 && indent < base;
		const mathEnd = !mathOff && !htmlParagraph && !lazy && !itemLazy && (marker || innerDepth > 0 || indent - base <= 3) ? mathBlockEnd(lines, i, content, depth + innerDepth, marker || listColumns.length ? contentBase : 0) : -1;
		if (mathEnd < 0 && MATH_MARKS.some((m) => m.open.test(content))) mathOff = true;
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
			// pi's parser (marked) may keep the lines after the comment's end in the HTML block up to a blank
			// line or a line that opens another block.
			for (; i < lines.length && lines[i].trim() && !INTERRUPT.test(blockOf(lines[i]).body); i++) push(code, i);
			i--;
			continue;
		}
		const plain = depth + innerDepth === 0 && !marker && listColumns.length === 0 && indent <= 3;
		if (!marker && HEADING.test(content) && indent - base <= 3) {
			paragraph = false;
			push({ kind: "heading", literal: literalOf(i, false), plain }, i);
			continue;
		}
		// An empty list item holds no paragraph yet.
		if (!paragraph && content.startsWith("<")) htmlParagraph = true;
		paragraph = !emptyItem;
		const paragraphPlain = plain && !/^[<|]/.test(body);
		push({ kind: "prose", literal: literalOf(i, true), plain: paragraphPlain }, i);
	}
	return read;
}

/**
 * The last line of the display math block that content (line i after its container markers) opens, or -1.
 * The closing mark must be in the same container: the same quote depth and, in a list item, indented to
 * its content. Follows pi-tui's tokenizeBlockLatex: the math between the marks is not empty and holds no table start.
 */
function mathBlockEnd(lines: string[], i: number, content: string, depth: number, itemBase: number): number {
	const marks = MATH_MARKS.find((m) => m.open.test(content));
	if (!marks) return -1;
	const MATH_CLOSE = marks.close;
	const open = content.match(marks.open)!;
	const rest = content.slice(open[0].length);
	const close = rest.match(MATH_CLOSE);
	if (close) return rest.length > close[0].length ? i : -1;
	const math = [rest];
	for (let k = i + 1; k < lines.length; k++) {
		const inner = blockOf(lines[k]);
		if (inner.depth !== depth || (inner.body && inner.indent < itemBase)) return -1;
		const end = lines[k].match(MATH_CLOSE);
		math.push(end ? lines[k].slice(0, end.index) : lines[k]);
		if (!end) continue;
		// pi drops the line break right after the opening "$$"; nothing else may be left.
		const body = (rest === "" ? math.slice(1) : math).join("\n");
		if (!body) return -1;
		const rows = body.split("\n");
		for (let r = 0; r + 1 < rows.length; r++) if ((rows[r + 1].includes("|") || rows[r].includes("|")) && TABLE_DELIMITER.test(rows[r + 1])) return -1;
		return k;
	}
	return -1;
}

/**
 * Where the count line goes: after the reply's first block when that is a top-level paragraph or heading
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
