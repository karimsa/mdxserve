import type { TextStyle } from "react-native";
import type { NativeTextRun } from "../../modules/selectable-text";
import type { BlockText, RunStyle } from "./block-runs";

/** A face, size and colour, as the stylesheet resolves a class list; colours are `processColor`'s numbers. */
interface Face {
	fontFamily: string;
	fontWeight: number;
	fontSize: number;
	color: number;
}

/**
 * The look of every kind of run in one block, in the current theme: the block's own text (a
 * paragraph's prose, a heading's level), and the classes elements.tsx draws the runs inside it
 * with (text-runs.ts).
 */
export interface RunTheme {
	base: Face & { lineHeight: number };
	strong: { fontWeight: number; color: number };
	link: number;
	code: Face & { background: number };
	footnoteSize: number;
	mark: number;
	markActive: number;
}

function colorOf(style: RunStyle, theme: RunTheme): number {
	switch (style.color) {
		case "heading":
			return theme.strong.color;
		case "link":
			return theme.link;
		case "accent":
			return theme.code.color;
		default:
			return theme.base.color;
	}
}

function backgroundOf(style: RunStyle, theme: RunTheme): number | null {
	switch (style.background) {
		case "code":
			return theme.code.background;
		case "mark":
			return theme.mark;
		case "active":
			return theme.markActive;
		default:
			return null;
	}
}

/**
 * The room around an inline code chip, each side: the chip view's `px-1` in elements.tsx. The
 * native text has no view to pad, so the character before the chip and the chip's last character
 * carry it as letter spacing, which the layout `Text` copies, and the chip's box is drawn into it.
 *
 * @internal Exported for its tests.
 */
export const CHIP_PADDING = 4;

/**
 * The block's runs as the native view takes them. Each keeps the index of the run it is drawn
 * from (`source`); the character before a chip and a chip's last character are runs of their own,
 * spaced by `CHIP_PADDING`.
 */
export function nativeRuns(text: BlockText, theme: RunTheme): NativeTextRun[] {
	const chip = (index: number) => text.runs[index]?.style.rounded === true;
	const runs: NativeTextRun[] = [];
	text.runs.forEach(({ text: value, style, press }, index) => {
		const run: NativeTextRun = {
			text: value,
			fontFamily: style.face === "mono" ? theme.code.fontFamily : theme.base.fontFamily,
			fontWeight:
				style.weight === "strong"
					? theme.strong.fontWeight
					: style.weight === "code"
						? theme.code.fontWeight
						: theme.base.fontWeight,
			fontSize:
				style.size === "code"
					? theme.code.fontSize
					: style.size === "footnote"
						? theme.footnoteSize
						: theme.base.fontSize,
			italic: style.italic,
			color: colorOf(style, theme),
			backgroundColor: backgroundOf(style, theme),
			rounded: style.rounded && style.background !== "none",
			strikethrough: style.strike,
			pressable: press !== null,
			letterSpacing: 0,
			source: index,
		};
		// Before a chip (its first run), and at a chip's end (its last run).
		const padded = (chip(index + 1) && !chip(index)) || (chip(index) && !chip(index + 1));
		if (!padded) {
			runs.push(run);
			return;
		}
		const characters = Array.from(value);
		const last = characters.pop() ?? "";
		if (characters.length > 0) runs.push({ ...run, text: characters.join("") });
		runs.push({ ...run, text: last, letterSpacing: CHIP_PADDING });
	});
	return runs;
}

/**
 * What a run's `Text` needs to take the room the native view's run takes: its face, size and
 * style. The block's line height comes from the `Text` around the runs.
 */
export function layoutStyle(run: NativeTextRun): TextStyle {
	return {
		fontFamily: run.fontFamily,
		fontWeight: String(run.fontWeight) as TextStyle["fontWeight"],
		fontSize: run.fontSize,
		fontStyle: run.italic ? "italic" : "normal",
		textDecorationLine: run.strikethrough ? "line-through" : "none",
		letterSpacing: run.letterSpacing,
	};
}
