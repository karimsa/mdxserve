// Type-only: src/ is never served to the browser, and every import here is erased.
import type {
	BlockNode,
	ComponentNode,
	DocumentTree,
	ElementNode,
	InlineNode,
	TocEntry,
} from "@karimsa/mdxserve/src/document/schema";

export type { BlockNode, ComponentNode, DocumentTree, ElementNode, InlineNode, TocEntry };

export type SectionNode = Extract<BlockNode, { type: "section" }>;
export type CodeNode = Extract<BlockNode, { type: "code" }>;
export type TableNode = Extract<BlockNode, { type: "table" }>;
export type TabsNode = Extract<BlockNode, { type: "tabs" }>;
export type FootnoteDefinitionNode = Extract<BlockNode, { type: "footnoteDefinition" }>;
export type ErrorNode = Extract<BlockNode, { type: "error" }>;

/** Any node a renderer can meet, block or inline. */
export type TreeNode = BlockNode | InlineNode;
