import { indexDocument, type TabStep } from "../document/document-index";
import type { BlockNode, DocumentTree, InlineNode } from "../document/tree-types";
import { headingKey, normalizeText, type BlockDescription, type ResolveIndex } from "./anchor";

/*
 * The web client finds a comment's text by reading the DOM (apps/web/src/comments/dom.ts): a
 * block is the innermost `p, li, td, th, h1…h6, pre, summary` (and a few more), and its text is
 * its text nodes joined. The app has no DOM, so this walks the document tree and yields the same
 * blocks, in the same order, with the same text nodes, from what the shared renderers would draw.
 * apps/web/tests/comments-tree-parity.test.tsx holds the two to each other.
 */

interface TreeBlock {
	/** What the renderer passes as `block`: the inline array the text is drawn from, or the code node. */
	key: object;
	kind: "heading" | "paragraph" | "item" | "cell" | "code";
	/** One string per DOM text node the web would have, in order. */
	nodes: readonly string[];
	/** For each string, the tree node whose `value` it is; null for text the tree has no node for. */
	sources: readonly (object | null)[];
	/** `normalizeText(nodes.join(""))`. */
	text: string;
	/** Index into `headings`, or -1 before the first heading. */
	section: number;
	/** The node whose list row draws this block: a top-level section for its heading, else the top-level block that holds it. */
	container: object;
	/** The tabs to select, outermost first, for the block to be visible. */
	tabSteps: readonly TabStep[];
}

export interface TreeBlocks {
	blocks: readonly TreeBlock[];
	/** The shape `resolveAnchor` takes. */
	index: ResolveIndex;
	/** The shape `captureAnchor` takes. */
	descriptions: readonly BlockDescription[];
	/** A block's position by its `key`. */
	positionOf(key: object): number | undefined;
}

/** Builtins that draw their children (or a string `children` prop) inside their own line of text. */
const PHRASING_BUILTINS = new Set(["Badge", "Kbd", "Tooltip"]);
/** Elements the web's block selector matches. */
const BLOCK_TAGS = new Set(["summary", "td", "th"]);
/** Elements whose children are blocks, a bare run of text among them in no block. */
const CONTAINER_TAGS = new Set(["details", "table", "thead", "tbody", "tr"]);

interface Walk {
	section: number;
	/** The top-level block being walked, or null while still on the chain of sections and preambles from the root. */
	container: object | null;
	tabSteps: readonly TabStep[];
}

type AnyNode = BlockNode | InlineNode;

function isParagraph(node: AnyNode): node is Extract<BlockNode, { type: "paragraph" }> {
	return node.type === "paragraph";
}

export function collectTreeBlocks(tree: DocumentTree): TreeBlocks {
	const footnoteNumbers = indexDocument(tree).footnoteNumbers;
	const blocks: TreeBlock[] = [];
	const headings: Array<{ key: string; block: number }> = [];
	const positions = new Map<object, number>();

	function inline(nodes: readonly AnyNode[], strings: string[], sources: (object | null)[]): void {
		for (const node of nodes) {
			switch (node.type) {
				case "text":
				case "inlineCode":
					strings.push(node.value);
					sources.push(node);
					break;
				case "emphasis":
				case "strong":
				case "delete":
				case "link":
				case "paragraph":
					inline(node.children, strings, sources);
					break;
				case "element":
					if (node.tag !== "br" && node.tag !== "img") inline(node.children, strings, sources);
					break;
				case "footnoteReference": {
					strings.push(String(footnoteNumbers.get(node.label) ?? "?"));
					sources.push(null);
					break;
				}
				case "component":
					if (!PHRASING_BUILTINS.has(node.name)) break;
					if (node.children.length > 0) inline(node.children, strings, sources);
					else if (typeof node.props.children === "string") {
						strings.push(node.props.children);
						sources.push(null);
					}
					break;
				default:
					break;
			}
		}
	}

	function emit(
		kind: TreeBlock["kind"],
		key: object,
		content: readonly AnyNode[],
		container: object,
		walk: Walk,
	): void {
		const nodes: string[] = [];
		const sources: (object | null)[] = [];
		inline(content, nodes, sources);
		push({ kind, key, nodes, sources, container, walk });
	}

	function push({
		kind,
		key,
		nodes,
		sources,
		container,
		walk,
	}: {
		kind: TreeBlock["kind"];
		key: object;
		nodes: string[];
		sources: (object | null)[];
		container: object;
		walk: Walk;
	}): void {
		positions.set(key, blocks.length);
		blocks.push({
			key,
			kind,
			nodes,
			sources,
			text: normalizeText(nodes.join("")),
			section: walk.section,
			container,
			tabSteps: walk.tabSteps,
		});
	}

	function visitAll(nodes: readonly AnyNode[], walk: Walk): Walk {
		let current = walk;
		for (const node of nodes) current = visit(node, current);
		return current;
	}

	/** Visits one node in block position and returns the walk after it (a heading moves the section on). */
	function visit(node: AnyNode, walk: Walk): Walk {
		const container = walk.container ?? node;
		const inside: Walk = { ...walk, container };
		const carry = (after: Walk): Walk => ({ ...walk, section: after.section });
		switch (node.type) {
			case "section": {
				const section = headings.length;
				const headingBlock = blocks.length;
				emit("heading", node.heading, node.heading, container, { ...walk, section });
				headings.push({ key: headingKey(blocks[headingBlock].text), block: headingBlock });
				// A top-level section is a row of its own; its children are rows of theirs.
				return carry(visitAll(node.children, { ...walk, section }));
			}
			case "preamble":
				return carry(visitAll(node.children, walk));
			case "paragraph":
				emit("paragraph", node.children, node.children, container, walk);
				return walk;
			case "blockquote":
				return carry(visitAll(node.children, inside));
			case "list": {
				let current = inside;
				for (const item of node.items) {
					const paragraphs = item.children.filter(isParagraph);
					const [only] = item.children;
					if (item.children.length === 1 && only && isParagraph(only)) {
						// A tight item's text is bare in its `li`, which is the block.
						emit("item", only.children, only.children, container, current);
						continue;
					}
					// One paragraph beside other blocks is bare in an `li` that holds a block, so the
					// web takes its text into no block; two or more each get a `p`.
					const shown =
						paragraphs.length === 1
							? item.children.filter((child) => !isParagraph(child))
							: item.children;
					current = visitAll(shown, current);
				}
				return carry(current);
			}
			case "code":
				// The web draws a Mermaid block as its diagram, its source hidden.
				if (node.lang === "mermaid") return walk;
				push({
					kind: "code",
					key: node,
					nodes: [node.value],
					sources: [node],
					container,
					walk,
				});
				return walk;
			case "table":
				for (const cell of node.head) emit("cell", cell, cell, container, inside);
				for (const row of node.rows)
					for (const cell of row) emit("cell", cell, cell, container, inside);
				return walk;
			case "tabs": {
				let current = inside;
				for (const tab of node.tabs)
					current = visitAll(tab.children, {
						...current,
						tabSteps: [...walk.tabSteps, { tabsId: node.id, value: tab.value }],
					});
				return carry(current);
			}
			case "component":
				return carry(visitAll(node.children, inside));
			case "element": {
				const [only] = node.children;
				const single = node.children.length === 1 && only !== undefined && isParagraph(only);
				if (BLOCK_TAGS.has(node.tag)) {
					const holdsBlocks = !single && node.children.some((child) => !isInline(child));
					if (!holdsBlocks) {
						emit(
							node.tag === "summary" ? "paragraph" : "cell",
							node,
							node.children,
							container,
							walk,
						);
						return walk;
					}
				} else if (!CONTAINER_TAGS.has(node.tag) && single) {
					// A phrasing element on its own line holds its paragraph's text bare.
					return walk;
				}
				return carry(visitAll(node.children, inside));
			}
			default:
				return walk;
		}
	}

	visitAll(tree.children, { section: -1, container: null, tabSteps: [] });

	return {
		blocks,
		index: {
			headings,
			blocks: blocks.map((block) => ({ text: block.text, section: block.section })),
		},
		descriptions: blocks.map((block) => ({
			heading: block.section === -1 ? null : headings[block.section].key,
			nodes: [...block.nodes],
		})),
		positionOf: (key) => positions.get(key),
	};
}

const INLINE_TYPES = new Set<AnyNode["type"]>([
	"text",
	"emphasis",
	"strong",
	"delete",
	"inlineCode",
	"link",
	"image",
	"break",
	"footnoteReference",
]);

function isInline(node: AnyNode): boolean {
	return INLINE_TYPES.has(node.type) || node.type === "component" || node.type === "element";
}
