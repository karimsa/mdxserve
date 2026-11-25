import {
	headingKey,
	mapNormalizedRange,
	normalizeText,
	resolveAnchor,
	type AnchorFields,
	type Resolution,
	type ResolveIndex,
} from "./anchor";

/** The innermost match of this selector inside the article is a block. */
export const BLOCK_SELECTOR =
	"p, li, td, th, h1, h2, h3, h4, h5, h6, pre, dt, dd, figcaption, summary";
const HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6";
/**
 * Never part of a block or its text. `.mdx-anchor` is the hover "#" link
 * Heading.tsx appends to a heading: it is chrome, not rendered text.
 */
const EXCLUDED_SELECTOR = "[data-editing], svg, button, .mdx-anchor";
/** Content of an inactive tab: still mounted, but hidden from the page. */
const HIDDEN_SELECTOR = '[inert], [aria-hidden="true"]';

export interface DomBlock {
	el: Element;
	nodes: Text[];
	/** Normalized text. */
	text: string;
	/** Index into `DomDoc.headings`, or -1 before the first heading. */
	section: number;
}

export interface DomHeading {
	/** `headingKey` of the text. */
	key: string;
	/** Index into `DomDoc.blocks`. */
	block: number;
}

export interface DomDoc {
	article: Element;
	blocks: DomBlock[];
	headings: DomHeading[];
}

function textNodesOf(block: Element): Text[] {
	const nodes: Text[] = [];
	const walker = block.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		const parent = node.parentElement;
		// The block itself is never inside an excluded element, so a match is within it.
		if (parent?.closest(EXCLUDED_SELECTOR) || parent?.closest(HIDDEN_SELECTOR)) continue;
		nodes.push(node as Text);
	}
	return nodes;
}

/** Headings and blocks of the article, in document order, per the plan's text model. */
export function collectDoc(article: Element): DomDoc {
	const blocks: DomBlock[] = [];
	const headings: DomHeading[] = [];
	let section = -1;
	for (const el of article.querySelectorAll(BLOCK_SELECTOR)) {
		if (el.querySelector(BLOCK_SELECTOR)) continue;
		if (el.closest(EXCLUDED_SELECTOR) || el.closest(HIDDEN_SELECTOR)) continue;
		const nodes = textNodesOf(el);
		const text = normalizeText(nodes.map((node) => node.data).join(""));
		if (el.matches(HEADING_SELECTOR)) {
			headings.push({ key: headingKey(text), block: blocks.length });
			section = headings.length - 1;
		}
		blocks.push({ el, nodes, text, section });
	}
	return { article, blocks, headings };
}

export function findArticle(root: ParentNode = document): Element | null {
	return root.querySelector("article.mdx-prose");
}

export function resolveIndexOf(doc: DomDoc): ResolveIndex {
	return {
		headings: doc.headings,
		blocks: doc.blocks.map((block) => ({ text: block.text, section: block.section })),
	};
}

export interface DomResolution {
	resolution: Resolution;
	/** The text to highlight; null for `section` and `detached`. */
	range: Range | null;
	/** What to scroll to when the thread is selected. */
	scrollTarget: Element | null;
}

function blockRange(block: DomBlock): Range | null {
	const first = block.nodes[0];
	const last = block.nodes[block.nodes.length - 1];
	if (!first || !last) return null;
	const range = block.el.ownerDocument.createRange();
	range.setStart(first, 0);
	range.setEnd(last, last.length);
	return range;
}

/** Resolves one anchor against the collected document and builds its DOM range. */
export function resolveInDom(
	doc: DomDoc,
	index: ResolveIndex,
	anchor: AnchorFields,
): DomResolution {
	const resolution = resolveAnchor(anchor, index);
	switch (resolution.state) {
		case "exact": {
			const block = doc.blocks[resolution.block];
			const mapped = mapNormalizedRange(
				block.nodes.map((node) => node.data),
				resolution.start,
				resolution.end,
			);
			if (!mapped) return { resolution, range: null, scrollTarget: block.el };
			const range = block.el.ownerDocument.createRange();
			range.setStart(block.nodes[mapped.start.node], mapped.start.offset);
			range.setEnd(block.nodes[mapped.end.node], mapped.end.offset);
			return { resolution, range, scrollTarget: block.el };
		}
		case "block": {
			const block = doc.blocks[resolution.block];
			return { resolution, range: blockRange(block), scrollTarget: block.el };
		}
		case "section":
			return {
				resolution,
				range: null,
				scrollTarget: resolution.block === -1 ? doc.article : doc.blocks[resolution.block].el,
			};
		case "detached":
			return { resolution, range: null, scrollTarget: null };
	}
}
