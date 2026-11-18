// Retained heap after GC (review round 1 on c0caf47, both P1 findings): what outlives a call (the streaming
// cache, the label and pill memos) must not keep earlier replies alive through slices of them.
// c0caf47 retained 38.6 MB for the first case and 4.36 MB for the second (Bun and Node alike); base 0d171d1
// about 0.5 MB and 0.01 MB. The same check runs under Node in ~/.pi/artifacts/worker/speed-cache/retention-check.mjs.
import { expect, test } from "bun:test";
import { load } from "./seam.ts";

const theme = { fg: (_: string, t: string) => "\x1b[31m" + t + "\x1b[39m", getFgAnsi: () => "\x1b[31m", getBgAnsi: () => "\x1b[41m", getColorMode: () => "256color", colors: {} };
const heap = () => {
	Bun.gc(true);
	Bun.gc(true);
	return process.memoryUsage().heapUsed;
};

// One reply's head: its drawing (about 200 KB as UTF-16) and a reading per line, with room for noise.
const HEAD_LIMIT = 4_000_000;
test("streaming one 98,309-char reply paragraph by paragraph keeps one head, not every frame's reply (under 4 MB)", () => {
	const ext = load(theme);
	let text = "Start";
	const start = heap();
	for (let i = 1; i <= 768; i++) {
		text += "\n\n" + String(i).padStart(126, "x");
		ext.draw(text, true);
	}
	expect(heap() - start).toBeLessThan(HEAD_LIMIT);
});

// At most 512 labels of at most 32 UTF-16 units per memo, with their split and drawn pill.
const LABEL_LIMIT = 1_000_000;
test("128 replies of 32 KB with one pill each leave no reply alive in the memos (under 1 MB)", () => {
	const ext = load(theme);
	const start = heap();
	for (let i = 0; i < 128; i++) ext.draw("a".repeat(32768) + " [[Status number " + i + "]]", true);
	ext.draw("unrelated", true);
	expect(heap() - start).toBeLessThan(LABEL_LIMIT);
});
