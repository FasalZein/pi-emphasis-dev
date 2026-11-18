// Property tests (Hegel) for the pure parts of the renderer: settings parsing, the count line, and
// what decorate leaves untouched.
import { expect, test } from "bun:test";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { DEFAULT_SETTINGS, VOCABULARY, countLine, createPalette, decorate, readSettings } from "../index.ts";

const TONES = ["success", "error", "warning", "ask", "danger", "mode", "owner", "neutral"] as const;
const COLOR = /^(#[0-9a-fA-F]{6}|[A-Za-z][A-Za-z0-9]*)$/;

// Values a hand-written settings block may hold: valid ones, near misses and other JSON types.
const value = gs.oneOf<unknown>(
	gs.sampledFrom(["round", "half", "sharp", "filled", "outline", "none", "panel", "solid", "text", "accent", "#ff966c", "#FF966C"]),
	gs.sampledFrom(["", "Round", "#ff966", "#gggggg", "1abc", "warning color", "rgb(1,2,3)"]),
	gs.integers({ minValue: -3, maxValue: 3 }),
	gs.booleans(),
	gs.none(),
	gs.arrays(gs.text({ maxSize: 4 }), { maxSize: 2 }),
);
const toneMap = gs.oneOf<unknown>(
	gs.record({ success: value, ask: value, neutral: value, extra: value }),
	value,
);

test("readSettings keeps a valid field and replaces any other value with the default", () =>
	hegel.test((tc) => {
		const raw = tc.draw(gs.oneOf<unknown>(gs.record({ edges: value, icons: value, labels: value, colors: toneMap, fill: toneMap }), value));
		const s = readSettings(raw);
		const r = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
		const keep = (v: unknown, ok: (x: string) => boolean, d: string) => (typeof v === "string" && ok(v) ? v : d);
		expect(s.edges).toBe(keep(r.edges, (x) => ["round", "half", "sharp"].includes(x), DEFAULT_SETTINGS.edges) as never);
		expect(s.icons).toBe(keep(r.icons, (x) => ["filled", "outline", "none"].includes(x), DEFAULT_SETTINGS.icons) as never);
		expect(s.labels).toBe(keep(r.labels, (x) => COLOR.test(x), DEFAULT_SETTINGS.labels));
		const colors = (r.colors && typeof r.colors === "object" && !Array.isArray(r.colors) ? r.colors : {}) as Record<string, unknown>;
		const fill = (r.fill && typeof r.fill === "object" && !Array.isArray(r.fill) ? r.fill : {}) as Record<string, unknown>;
		for (const t of TONES) {
			expect(s.colors[t]).toBe(keep(colors[t], (x) => COLOR.test(x), DEFAULT_SETTINGS.colors[t]));
			expect(s.fill[t]).toBe(keep(fill[t], (x) => ["panel", "solid", "text"].includes(x), DEFAULT_SETTINGS.fill[t]) as never);
		}
		expect(Object.keys(s.colors).sort()).toEqual([...TONES].sort());
	}));

// The count line's oracle, built from VOCABULARY rather than from the renderer's own tone lookup.
const STATE = ["ask", "error", "warning", "success"] as const;
const stateWords = STATE.flatMap((t) => VOCABULARY[t].core.map((w) => [w, t] as const));
const otherWords = [...VOCABULARY.mode.core, ...VOCABULARY.danger.core, ...VOCABULARY.owner.core, "Inferred", "Anything"];
const pillWord = gs.oneOf(gs.sampledFrom(stateWords.map(([w]) => w)), gs.sampledFrom(otherWords));
const placed = gs.record({ word: pillWord, inCode: gs.booleans() });

test("the count line counts every state pill outside code, asks first, when there are 5 or more of 2 words", () =>
	hegel.test((tc) => {
		const bullets = tc.draw(gs.arrays(gs.arrays(placed, { maxSize: 3 }), { maxSize: 12 }));
		const md = ["**Result:** x", "", ...bullets.map((ps) => "- item " + ps.map((p) => (p.inCode ? "\x60[[" + p.word + "]]\x60" : "[[" + p.word + "]]")).join(" text "))].join("\n");
		const tally = new Map<string, number>();
		for (const p of bullets.flat()) {
			if (p.inCode) continue;
			if (stateWords.some(([w]) => w === p.word)) tally.set(p.word, (tally.get(p.word) ?? 0) + 1);
		}
		const total = [...tally.values()].reduce((a, b) => a + b, 0);
		const tone = (w: string) => STATE.indexOf(stateWords.find(([x]) => x === w)![1]);
		const expected = total >= 5 && tally.size >= 2
			? [...tally.keys()].sort((a, b) => tone(a) - tone(b)).map((w) => "[[" + w + " " + tally.get(w) + "]]").join(" ")
			: undefined;
		expect(countLine(md)).toBe(expected);
	}));

const theme = {
	fg: (c: string, t: string) => "<" + c + ">" + t + "</>",
	getFgAnsi: (c: string) => "\x1b[38;fg-" + c + "m",
	getBgAnsi: (c: string) => "\x1b[48;bg-" + c + "m",
} as never;
const palette = createPalette(theme);
const codeText = gs.text({ alphabet: "ab [*]$\\_D1:→✓├─#", minSize: 1, maxSize: 16 });

test("words that name inherited object members are no table entries", () =>
	hegel.test((tc) => {
		const word = tc.draw(gs.sampledFrom(["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf", "isPrototypeOf"]));
		const shape = tc.draw(gs.sampledFrom(["## W", "**W:** x", "- **W** x", "x [[W]]", "[[W 3]]", "x\n\n- [[W]]\n- [[Done]]\n- [[Done]]\n- [[Failed]]\n- [[W]]\n- [[Failed]]"]));
		const md = shape.replaceAll("W", word);
		const out = decorate(md, palette);
		expect(out).not.toContain("function");
		expect(out).not.toContain("[object");
		expect(countLine(md) ?? "").not.toContain("function");
	}));

test("an unknown theme color name never stops the drawing and falls back to the tone's default", () =>
	hegel.test((tc) => {
		const known = new Set(["success", "error", "warning", "accent", "customMessageLabel", "text", "thinkingMinimal", "dim", "mdLink"]);
		const strict = {
			fg: (c: string, t: string) => { if (!known.has(c)) throw new Error("Unknown theme color: " + c); return "<" + c + ">" + t + "</>"; },
			getFgAnsi: (c: string) => { if (!known.has(c)) throw new Error("Unknown theme color: " + c); return "\x1b[38;fg-" + c + "m"; },
			getBgAnsi: (c: string) => "\x1b[48;bg-" + c + "m",
		} as never;
		const name = tc.draw(gs.oneOf(gs.sampledFrom([...known]), gs.text({ alphabet: "abcteal", minSize: 1, maxSize: 8 })));
		const tone = tc.draw(gs.sampledFrom(["success", "error", "warning", "ask", "danger", "mode", "owner", "neutral"] as const));
		const settings = readSettings({ labels: name, colors: { [tone]: name } });
		const word = { success: "Done", error: "Failed", warning: "Partial", ask: "Needs you", danger: "Destructive", mode: "Implement", owner: "Shared", neutral: "Anything" }[tone];
		const out = decorate("**Cause:** [[" + word + "]]", createPalette(strict, settings));
		const expected = decorate("**Cause:** [[" + word + "]]", createPalette(strict, known.has(name) ? settings : DEFAULT_SETTINGS));
		expect(out).toBe(expected);
	}));

test("decorate leaves inline code spans byte for byte", () =>
	hegel.test((tc) => {
		const code = tc.draw(codeText);
		const before = tc.draw(gs.sampledFrom(["", "**Fix:** ", "- **Build** [[Passed]] ", "saves $20 "]));
		const line = before + "\x60" + code + "\x60" + " after [[Done]]";
		expect(decorate(line, palette)).toContain("\x60" + code + "\x60");
	}));

test("decorate leaves fenced code lines byte for byte", () =>
	hegel.test((tc) => {
		const body = tc.draw(gs.arrays(codeText, { minSize: 1, maxSize: 4 }));
		const md = ["**Result:** x", "\x60\x60\x60", ...body, "\x60\x60\x60"].join("\n");
		expect(decorate(md, palette).split("\n").slice(1)).toEqual(md.split("\n").slice(1));
	}));
