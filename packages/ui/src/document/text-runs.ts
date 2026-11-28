import { createContext, type ComponentType, type ReactNode } from "react";

/*
 * What the app's text elements (elements.tsx) and its selectable text (apps/mobile/src/selection/)
 * share: the classes each kind of run is drawn in, so a block drawn as native selectable text
 * looks like the same block drawn with React Native's `Text`, and the context through which the
 * app hands the text elements its selectable block. The web never imports this file.
 */

/** Prose: paragraphs and list items (16.5 pt × 1.72, Manrope). */
export const PROSE =
	"font-sans text-[length:var(--size-prose)] leading-[var(--leading-prose)] text-text-body";
/** Bold text, and `<b>`/`<strong>`. */
export const STRONG = "font-semibold text-text-heading";
/** A link's text. */
export const LINK = "text-text-link";
/** Inline code's face and colour, and its size. */
export const CODE_TEXT = "font-mono font-medium text-text-accent";
export const CODE_SIZE = "text-[length:var(--size-sm)]";
/** The background of inline code short enough to be a chip. */
export const CODE_BACKGROUND = "bg-code-bg-inline";
/** A footnote reference, `[1]`. */
export const FOOTNOTE = "text-[length:var(--size-xs)] text-text-link";
/** A comment highlight's background, and the active thread's (the `--comment-mark` tokens). */
export const MARK = "bg-comment-mark";
export const MARK_ACTIVE = "bg-comment-mark-active";
/** Code no longer than this, with no space in it, is drawn as a chip. */
export const CHIP_LIMIT = 24;

/** Whether inline code is short enough, and has no space, to be drawn as a chip. */
export function isChip(value: string): boolean {
	return value.length <= CHIP_LIMIT && !/\s/.test(value);
}

/**
 * Each run of spaces, tabs and newlines as one space, as HTML shows a text node (a no-break
 * space is kept): a `Text` would break the line at a Markdown soft line break.
 */
export function textOf(value: string): string {
	return value.replace(/[ \t\n\r\f]+/g, " ");
}

/** How a block's text is drawn: its text classes, the space around it, and what it is. */
export interface BlockLook {
	/** The classes of the block's `Text`: face, size, line height and colour. */
	text: string;
	/** Margins around the block. */
	spacing: string;
	/** A heading's level, for VoiceOver. */
	heading?: 1 | 2 | 3 | 4 | 5 | 6;
	/** A heading's anchor id. */
	nativeID?: string;
}

export interface SelectableBlockProps {
	/** The block's inline nodes (the `block` the renderer passes). */
	block: object;
	look: BlockLook;
	/** The block drawn with React Native's `Text`, for a block selectable text cannot draw. */
	fallback: ReactNode;
}

/**
 * The app's selectable block (native text whose selection menu has Copy and Comment), set only
 * where the development build's native module exists. Null, as in Expo Go and the tests, draws
 * every block with `Text`.
 */
export const SelectableBlockContext = createContext<ComponentType<SelectableBlockProps> | null>(
	null,
);
