import {
	captureAnchor,
	mapNormalizedRange,
	normalizeText,
	type AnchorFields,
	type BlockDescription,
	type NodePoint,
} from "@mdxserve/client/comments/anchor";
import { splitByMarks, type TextMark } from "@mdxserve/client/comments/marks";
import type { InlineNode } from "@mdxserve/client/document/tree-types";
import { isChip } from "@mdxserve/ui/document/text-runs";

/*
 * A block of the document as the runs of styled text the native selectable view draws, and the
 * map from every UTF-16 unit of that text back to the block's strings in the web's block model
 * (`collectTreeBlocks`), so a selection becomes the anchor the web would make from the same
 * characters. The text is the one React Native's `Text` shows for the block (elements.tsx), and
 * runs and map are made in one walk, so they cannot drift apart.
 */

/** What colours a run, innermost wins (as in nested `Text`). */
type ColorRole = "base" | "heading" | "link" | "accent";

export interface RunStyle {
	italic: boolean;
	strike: boolean;
	color: ColorRole;
	/** The prose's (or heading's) face, or inline code's. */
	face: "base" | "mono";
	size: "base" | "code" | "footnote";
	weight: "base" | "strong" | "code";
	background: "none" | "code" | "mark" | "active";
	/** Inline code short enough to be a chip: its background is rounded. */
	rounded: boolean;
}

/** What tapping a run does: open a link, or a thread's highlight. */
type RunPress = { kind: "link"; href: string } | { kind: "mark"; threadIds: readonly string[] };

interface Run {
	text: string;
	style: RunStyle;
	press: RunPress | null;
}

export interface BlockText {
	/** Every run's text, joined: what the view shows and what its selection offsets count. */
	text: string;
	runs: readonly Run[];
	/** For each UTF-16 unit of `text`, the block string and offset it shows, or null for text the web has not (a break, `[` and `]`). */
	map: readonly (NodePoint | null)[];
}

/** The block as `collectTreeBlocks` made it: its strings and the node each one is the value of. */
interface BlockStrings {
	nodes: readonly string[];
	sources: readonly (object | null)[];
}

export interface RunMarks {
	/** The marks on a text or inline code node. */
	marksOf(source: object): readonly TextMark[] | undefined;
	activeThread: string | null;
}

interface Context {
	italic: boolean;
	strike: boolean;
	color: ColorRole;
	weight: RunStyle["weight"];
	/** The link the text is inside: it takes the press, a highlight in it does not. */
	link: string | null;
}

const COLLAPSIBLE = /[ \t\n\r\f]/;

/** A node a run cannot draw: the block keeps `Text`. */
class Unsupported extends Error {}

/**
 * The runs and map of a block whose inline nodes are `content` and whose strings are `block`'s,
 * or null when it holds something runs cannot draw (an image, a builtin, an HTML element) or does
 * not match those strings.
 */
export function blockRuns(
	content: readonly InlineNode[],
	block: BlockStrings,
	marks: RunMarks,
): BlockText | null {
	const runs: Run[] = [];
	const map: (NodePoint | null)[] = [];
	let next = 0;

	function push(
		text: string,
		style: RunStyle,
		press: RunPress | null,
		points: (NodePoint | null)[],
	) {
		if (text === "") return;
		runs.push({ text, style, press });
		map.push(...points);
	}

	function base(context: Context): RunStyle {
		return {
			italic: context.italic,
			strike: context.strike,
			color: context.color,
			face: "base",
			size: "base",
			weight: context.weight,
			background: "none",
			rounded: false,
		};
	}

	/** The string `node` is the value of, checked against the block's. */
	function claim(node: object): number {
		const index = next;
		if (block.sources[index] !== node) throw new Unsupported();
		next += 1;
		return index;
	}

	/** A text or inline code node, cut at its marks; text has each run of whitespace collapsed. */
	function value(node: { value: string }, context: Context, code: boolean): void {
		const index = claim(node);
		const chip = code && isChip(node.value);
		for (const piece of splitByMarks(node.value.length, marks.marksOf(node) ?? [])) {
			let text = "";
			const points: NodePoint[] = [];
			for (let offset = piece.start; offset < piece.end; offset++) {
				const char = node.value[offset];
				if (!code && COLLAPSIBLE.test(char)) {
					// One space for the run, standing for its first character.
					if (offset > piece.start && COLLAPSIBLE.test(node.value[offset - 1])) continue;
					text += " ";
				} else text += char;
				points.push({ node: index, offset });
			}
			const marked = piece.threadIds.length > 0;
			const background: RunStyle["background"] = marked
				? piece.threadIds.includes(marks.activeThread ?? "")
					? "active"
					: "mark"
				: chip
					? "code"
					: "none";
			const style: RunStyle = code
				? {
						...base(context),
						color: "accent",
						face: "mono",
						size: "code",
						weight: "code",
						background,
						rounded: chip,
					}
				: { ...base(context), background };
			const press: RunPress | null =
				context.link !== null
					? { kind: "link", href: context.link }
					: marked
						? { kind: "mark", threadIds: piece.threadIds }
						: null;
			push(text, style, press, points);
		}
	}

	function walk(nodes: readonly InlineNode[], context: Context): void {
		for (const node of nodes) {
			switch (node.type) {
				case "text":
					value(node, context, false);
					break;
				case "inlineCode":
					value(node, context, true);
					break;
				case "emphasis":
					walk(node.children, { ...context, italic: true });
					break;
				case "strong":
					walk(node.children, { ...context, color: "heading", weight: "strong" });
					break;
				case "delete":
					walk(node.children, { ...context, strike: true });
					break;
				case "link":
					walk(node.children, { ...context, color: "link", link: node.href });
					break;
				case "break":
					push("\n", base(context), null, [null]);
					break;
				case "footnoteReference": {
					const index = next;
					if (block.sources[index] !== null || index >= block.nodes.length) throw new Unsupported();
					next += 1;
					const number = block.nodes[index];
					const points: (NodePoint | null)[] = [null];
					for (let offset = 0; offset < number.length; offset++)
						points.push({ node: index, offset });
					points.push(null);
					push(`[${number}]`, { ...base(context), color: "link", size: "footnote" }, null, points);
					break;
				}
				default:
					throw new Unsupported();
			}
		}
	}

	try {
		walk(content, { italic: false, strike: false, color: "base", weight: "base", link: null });
	} catch (error) {
		if (error instanceof Unsupported) return null;
		throw error;
	}
	if (next !== block.nodes.length) return null;
	return { text: runs.map((run) => run.text).join(""), runs, map };
}

/** What the native view reported when the reader chose Comment. */
export interface SelectionEvent {
	start: number;
	end: number;
	text: string;
}

export type SelectionAnchor =
	{ kind: "ok"; anchor: AnchorFields } | { kind: "refused"; message: string };

const REFUSED: SelectionAnchor = {
	kind: "refused",
	message: "This selection could not be turned into a comment.",
};

/**
 * The anchor for characters [start, end) of a block's text. The offsets are trusted only when
 * the text they cover is the text the view reported; otherwise the reported text, normalized, is
 * looked for in the block. Characters the web has not (a break, a footnote's brackets) at either
 * end are dropped.
 */
export function anchorFromSelection(
	text: BlockText,
	blocks: readonly BlockDescription[],
	blockIndex: number,
	selection: SelectionEvent,
): SelectionAnchor {
	const description = blocks[blockIndex];
	if (!description) return REFUSED;
	const { start, end } = selection;
	const trusted =
		Number.isInteger(start) &&
		Number.isInteger(end) &&
		start >= 0 &&
		end <= text.text.length &&
		start < end &&
		text.text.slice(start, end) === selection.text;
	if (!trusted) {
		const quote = normalizeText(selection.text);
		const blockText = normalizeText(description.nodes.join(""));
		const found = quote === "" ? -1 : blockText.indexOf(quote);
		if (found === -1) return REFUSED;
		const range = mapNormalizedRange(description.nodes, found, found + quote.length);
		const anchor = range && captureAnchor(blocks, { blockIndex, ...range });
		return anchor ? { kind: "ok", anchor } : REFUSED;
	}
	let first = start;
	while (first < end && text.map[first] === null) first += 1;
	let last = end - 1;
	while (last >= first && text.map[last] === null) last -= 1;
	const from = text.map[first];
	const to = text.map[last];
	if (first > last || !from || !to) return REFUSED;
	const anchor = captureAnchor(blocks, {
		blockIndex,
		start: from,
		end: { node: to.node, offset: to.offset + 1 },
	});
	return anchor ? { kind: "ok", anchor } : REFUSED;
}
