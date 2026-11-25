/**
 * Pure anchor logic: no DOM types, so it runs under plain Node in tests.
 *
 * `client/` may only `import type` from `src/`, so the limits and
 * `normalizeText` below repeat `src/comments/schema.ts` and
 * `src/comments/anchor.ts`; tests/client/comments-limits.test.ts asserts the
 * two copies agree.
 */

export const MAX_ANCHOR_TEXT = 500;
export const MAX_ANCHOR_HEADING = 300;
export const MAX_MESSAGE_BODY = 4000;

/** Collapse runs of whitespace to one space, then trim. Must match `src/comments/anchor.ts`. */
export function normalizeText(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

/**
 * The comparable form of a heading's text: normalized and cut to the schema's
 * heading limit, so a very long heading still matches its stored anchor.
 */
export function headingKey(text: string): string {
	return normalizeText(text).slice(0, MAX_ANCHOR_HEADING).trimEnd();
}

export interface AnchorFields {
	heading: string | null;
	block: string;
	quote: string;
}

// ── offset mapping ──────────────────────────────────────────────────────────

export interface NormalizedText {
	/** `normalizeText(nodes.join(""))`. */
	text: string;
	/** For each normalized character, its index in the joined raw text. */
	rawIndex: number[];
}

/** Normalizes the concatenated text nodes and remembers where each character came from. */
export function normalizeWithMap(nodes: readonly string[]): NormalizedText {
	const raw = nodes.join("");
	let text = "";
	const rawIndex: number[] = [];
	let pendingSpace = -1;
	for (let index = 0; index < raw.length; index++) {
		const char = raw[index];
		if (/\s/.test(char)) {
			if (text.length > 0 && pendingSpace === -1) pendingSpace = index;
			continue;
		}
		if (pendingSpace !== -1) {
			text += " ";
			rawIndex.push(pendingSpace);
			pendingSpace = -1;
		}
		text += char;
		rawIndex.push(index);
	}
	return { text, rawIndex };
}

export interface NodePoint {
	node: number;
	offset: number;
}

export interface NodeRange {
	start: NodePoint;
	end: NodePoint;
}

function pointAt(nodes: readonly string[], rawIndex: number): NodePoint {
	let remaining = rawIndex;
	for (let node = 0; node < nodes.length; node++) {
		if (remaining < nodes[node].length) return { node, offset: remaining };
		remaining -= nodes[node].length;
	}
	return { node: Math.max(0, nodes.length - 1), offset: nodes[nodes.length - 1]?.length ?? 0 };
}

/**
 * Maps the normalized-text span [start, end) back to text-node points. The start
 * sits on the first character of the span and the end just after its last one, so
 * a boundary between two nodes never gets ambiguous. Null for an empty or
 * out-of-bounds span.
 */
export function mapNormalizedRange(
	nodes: readonly string[],
	start: number,
	end: number,
): NodeRange | null {
	const { text, rawIndex } = normalizeWithMap(nodes);
	if (start < 0 || end > text.length || start >= end) return null;
	const first = pointAt(nodes, rawIndex[start]);
	const last = pointAt(nodes, rawIndex[end - 1]);
	return { start: first, end: { node: last.node, offset: last.offset + 1 } };
}

// ── capture ─────────────────────────────────────────────────────────────────

export interface BlockDescription {
	/** Heading text of the block's section (already `headingKey`ed), or null before the first heading. */
	heading: string | null;
	/** The text-node strings of the block, in document order. */
	nodes: string[];
}

export interface SelectionDescription {
	blockIndex: number;
	start: NodePoint;
	/** Null clips the selection to the end of the block. */
	end: NodePoint | null;
}

function rawOffset(nodes: readonly string[], point: NodePoint): number {
	let total = 0;
	for (let node = 0; node < point.node && node < nodes.length; node++) total += nodes[node].length;
	return total + point.offset;
}

/** The anchor for a selection, clipped to the block holding its start. Null when it has no text. */
export function captureAnchor(
	blocks: readonly BlockDescription[],
	selection: SelectionDescription,
): AnchorFields | null {
	const block = blocks[selection.blockIndex];
	if (!block) return null;
	const raw = block.nodes.join("");
	const startRaw = rawOffset(block.nodes, selection.start);
	const endRaw = selection.end ? rawOffset(block.nodes, selection.end) : raw.length;
	if (endRaw <= startRaw) return null;

	const quote = normalizeText(raw.slice(startRaw, endRaw)).slice(0, MAX_ANCHOR_TEXT).trimEnd();
	if (!quote) return null;
	const blockText = normalizeText(raw).slice(-MAX_ANCHOR_TEXT).trimStart();
	return { heading: block.heading, block: blockText, quote };
}

// ── resolve ─────────────────────────────────────────────────────────────────

export interface ResolveBlock {
	/** Normalized text of the block. */
	text: string;
	/** Index into `headings` of the block's section, or -1 before the first heading. */
	section: number;
}

export interface ResolveHeading {
	/** `headingKey` of the heading's text. */
	key: string;
	/** Index into `blocks` of the heading's own block. */
	block: number;
}

export interface ResolveIndex {
	headings: readonly ResolveHeading[];
	blocks: readonly ResolveBlock[];
}

export type Resolution =
	| { state: "exact"; block: number; start: number; end: number }
	| { state: "block"; block: number }
	/** `block` is the heading's block, or -1 for the top of the article. */
	| { state: "section"; block: number }
	| { state: "detached" };

export type AnchorState = Resolution["state"];

/** Where the thread sorts in the document: a block index, -1 for the top, Infinity when detached. */
export function resolutionPosition(resolution: Resolution): number {
	return resolution.state === "detached" ? Infinity : resolution.block;
}

/** Finds the anchor in the document: exact, whole block, section heading, or detached. */
export function resolveAnchor(anchor: AnchorFields, index: ResolveIndex): Resolution {
	const wantedBlock = normalizeText(anchor.block);
	const wantedQuote = normalizeText(anchor.quote);
	const sections: number[] = [];
	if (anchor.heading === null) {
		sections.push(-1);
	} else {
		const wantedHeading = headingKey(anchor.heading);
		index.headings.forEach((heading, position) => {
			if (heading.key === wantedHeading) sections.push(position);
		});
		if (sections.length === 0) return { state: "detached" };
	}

	for (const section of sections) {
		for (let position = 0; position < index.blocks.length; position++) {
			const block = index.blocks[position];
			if (block.section !== section || !block.text.endsWith(wantedBlock)) continue;
			const found = block.text.indexOf(wantedQuote);
			if (found === -1) return { state: "block", block: position };
			return { state: "exact", block: position, start: found, end: found + wantedQuote.length };
		}
	}

	const headingBlock = sections[0] === -1 ? -1 : index.headings[sections[0]].block;
	return { state: "section", block: headingBlock };
}
