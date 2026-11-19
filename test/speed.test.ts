// The block reader's time grows linearly with the reply. Each unclosed "$"
// searched the rest of its paragraph, so a paragraph of N such lines took time quadratic in N.
import { expect, test } from "bun:test";
import { readMarkdown } from "../reader.ts";

/** The fastest of 7 samples, each the mean of enough calls to last well above the timer's resolution. */
function time(lines: string[]): number {
	const calls = Math.max(1, Math.round(16384 / lines.length));
	let best = Number.POSITIVE_INFINITY;
	for (let s = 0; s < 7; s++) {
		const start = performance.now();
		for (let c = 0; c < calls; c++) readMarkdown(lines);
		best = Math.min(best, (performance.now() - start) / calls);
	}
	return best;
}

// 4 times the lines: linear time grows 4 times, quadratic time 16 times. The limit, 8 times, sits between
// the two with room for noise on a shared machine (garbage collection, other processes).
const GROWTH_LIMIT = 8;

test("an unclosed $ on every line of one paragraph: 2048 lines take at most 8 times as long as 512", () => {
	const paragraph = (n: number) => Array(n).fill("Expense costs $12");
	time(paragraph(2048));
	const small = time(paragraph(512));
	const large = time(paragraph(2048));
	expect(large / small).toBeLessThan(GROWTH_LIMIT);
});
