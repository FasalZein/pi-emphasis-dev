// A truecolor theme with tokyonight's values (themes/tokyonight.json), so escapes carry RGB. Shared by the tests.
import { rgbColor } from "@earendil-works/pi-tui";
import type { Theme } from "./seam.ts";

export const RGB: Record<string, [number, number, number]> = {
	success: [195, 232, 141], error: [255, 117, 127], warning: [255, 199, 119], accent: [130, 170, 255], customMessageLabel: [192, 153, 255],
	text: [200, 211, 245], thinkingMinimal: [79, 214, 190], mdLink: [130, 170, 255], dim: [84, 92, 126], toolPendingBg: [26, 27, 38], selectedBg: [47, 51, 77],
	mdListBullet: [134, 225, 252], mdQuote: [130, 139, 184], toolSuccessBg: [30, 43, 40], toolErrorBg: [44, 32, 48], searchMatchBg: [47, 51, 77],
};
export const fgEsc = (name: string) => "\x1b[38;2;" + RGB[name].join(";") + "m";
export const truecolor: Theme = {
	fg: (name: never, text: string) => fgEsc(name) + text + "\x1b[39m",
	getFgAnsi: (name: never) => fgEsc(name),
	getBgAnsi: (name: never) => "\x1b[48;2;" + RGB[name].join(";") + "m",
	getColorMode: () => "truecolor",
	colors: Object.fromEntries(Object.entries(RGB).map(([name, [r, g, b]]) => [name, rgbColor(r, g, b)])),
};
