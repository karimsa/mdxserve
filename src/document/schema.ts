import { z } from "zod";
import type { Json } from "./literal.js";

/**
 * The JSON a client renders a document from. No node carries a source
 * position, HTML, a CSS class or a style; code is plain text. A client that
 * meets a node `type`, component `name` or element `tag` it does not know
 * renders a placeholder for that node and goes on.
 */

/** Bumped when a node type or field changes meaning. */
export const DOCUMENT_SCHEMA_VERSION = 1;

export interface DocMetadata {
	title?: string;
	description?: string;
	canonical?: string;
	openGraph: { property: string; content: string }[];
}

export interface TocEntry {
	/** Equals the `id` of a section node or a tab. Also the URL anchor. */
	id: string;
	/** Plain text. For a tab, the tab's label. */
	label: string;
	kind: "heading" | "tab";
	children: TocEntry[];
}

export type InlineNode =
	| { type: "text"; value: string }
	| { type: "emphasis"; children: InlineNode[] }
	| { type: "strong"; children: InlineNode[] }
	| { type: "delete"; children: InlineNode[] }
	| { type: "inlineCode"; value: string }
	| { type: "link"; href: string; title: string | null; children: InlineNode[] }
	| { type: "image"; src: string; alt: string; title: string | null }
	| { type: "break" }
	| { type: "footnoteReference"; label: string }
	| ComponentNode
	| ElementNode;

/** A builtin. `name` is a key of the component registry. Used in block and inline position. */
export interface ComponentNode {
	type: "component";
	/** Authored for stateful builtins, positional for other block builtins, null inline. */
	id: string | null;
	name: string;
	props: { [key: string]: Json };
	children: (BlockNode | InlineNode)[];
}

/** A supported lowercase element. Used in block and inline position. */
export interface ElementNode {
	type: "element";
	/** Set for `details`, null for every other tag. */
	id: string | null;
	tag: string;
	attrs: { [key: string]: string | boolean };
	children: (BlockNode | InlineNode)[];
}

export interface ListItem {
	/** null for an ordinary item, true or false for a task list item. */
	checked: boolean | null;
	children: BlockNode[];
}

export interface TabNode {
	/** `<Tabs id>` + ">" + `<value>`. */
	id: string;
	value: string;
	label: string;
	children: BlockNode[];
}

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type TableAlign = "left" | "center" | "right" | null;

export type BlockNode =
	| {
			type: "section";
			id: string;
			level: HeadingLevel;
			heading: InlineNode[];
			children: BlockNode[];
	  }
	| { type: "preamble"; id: string; children: BlockNode[] }
	| { type: "paragraph"; children: InlineNode[] }
	| { type: "blockquote"; children: BlockNode[] }
	| { type: "list"; ordered: boolean; start: number | null; items: ListItem[] }
	| {
			type: "code";
			/** Set for a mermaid block, null for other languages. */
			id: string | null;
			lang: string | null;
			title: string | null;
			showLineNumbers: boolean;
			/** 1-based lines to highlight, from fence meta such as `{3-4}`. */
			highlightLines: number[];
			value: string;
	  }
	| {
			type: "table";
			/** The hash id the renderer has always given a Markdown table. */
			id: string;
			/** False when that id is ambiguous and table preferences must not persist. */
			persist: boolean;
			align: TableAlign[];
			head: InlineNode[][];
			rows: InlineNode[][][];
	  }
	| { type: "thematicBreak" }
	| { type: "tabs"; id: string; defaultValue: string; tabs: TabNode[] }
	| ComponentNode
	| ElementNode
	| { type: "footnoteDefinition"; label: string; children: BlockNode[] }
	| { type: "error"; id: string; message: string; source: string };

export interface DocumentTree {
	/** Bumped when a node type or field changes meaning. Starts at 1. */
	schemaVersion: typeof DOCUMENT_SCHEMA_VERSION;
	metadata: DocMetadata;
	toc: TocEntry[];
	children: BlockNode[];
}

export const jsonSchema: z.ZodType<Json> = z.lazy(() =>
	z.union([
		z.string(),
		z.number(),
		z.boolean(),
		z.null(),
		z.array(jsonSchema),
		z.record(z.string(), jsonSchema),
	]),
);

export const docMetadataSchema = z.object({
	title: z.string().optional(),
	description: z.string().optional(),
	canonical: z.string().optional(),
	openGraph: z.array(z.object({ property: z.string(), content: z.string() })),
});

export const tocEntrySchema: z.ZodType<TocEntry> = z.object({
	id: z.string(),
	label: z.string(),
	kind: z.enum(["heading", "tab"]),
	get children() {
		return z.array(tocEntrySchema);
	},
});

export const componentNodeSchema: z.ZodType<ComponentNode> = z.object({
	type: z.literal("component"),
	id: z.string().nullable(),
	name: z.string(),
	props: z.record(z.string(), jsonSchema),
	get children() {
		return z.array(z.union([blockNodeSchema, inlineNodeSchema]));
	},
});

export const elementNodeSchema: z.ZodType<ElementNode> = z.object({
	type: z.literal("element"),
	id: z.string().nullable(),
	tag: z.string(),
	attrs: z.record(z.string(), z.union([z.string(), z.boolean()])),
	get children() {
		return z.array(z.union([blockNodeSchema, inlineNodeSchema]));
	},
});

export const inlineNodeSchema: z.ZodType<InlineNode> = z.lazy(() =>
	z.union([
		z.object({ type: z.literal("text"), value: z.string() }),
		z.object({ type: z.literal("emphasis"), children: z.array(inlineNodeSchema) }),
		z.object({ type: z.literal("strong"), children: z.array(inlineNodeSchema) }),
		z.object({ type: z.literal("delete"), children: z.array(inlineNodeSchema) }),
		z.object({ type: z.literal("inlineCode"), value: z.string() }),
		z.object({
			type: z.literal("link"),
			href: z.string(),
			title: z.string().nullable(),
			children: z.array(inlineNodeSchema),
		}),
		z.object({
			type: z.literal("image"),
			src: z.string(),
			alt: z.string(),
			title: z.string().nullable(),
		}),
		z.object({ type: z.literal("break") }),
		z.object({ type: z.literal("footnoteReference"), label: z.string() }),
		componentNodeSchema,
		elementNodeSchema,
	]),
);

const headingLevelSchema = z.union([
	z.literal(1),
	z.literal(2),
	z.literal(3),
	z.literal(4),
	z.literal(5),
	z.literal(6),
]);

export const listItemSchema: z.ZodType<ListItem> = z.object({
	checked: z.boolean().nullable(),
	get children() {
		return z.array(blockNodeSchema);
	},
});

export const tabNodeSchema: z.ZodType<TabNode> = z.object({
	id: z.string(),
	value: z.string(),
	label: z.string(),
	get children() {
		return z.array(blockNodeSchema);
	},
});

export const blockNodeSchema: z.ZodType<BlockNode> = z.lazy(() =>
	z.union([
		z.object({
			type: z.literal("section"),
			id: z.string(),
			level: headingLevelSchema,
			heading: z.array(inlineNodeSchema),
			children: z.array(blockNodeSchema),
		}),
		z.object({ type: z.literal("preamble"), id: z.string(), children: z.array(blockNodeSchema) }),
		z.object({ type: z.literal("paragraph"), children: z.array(inlineNodeSchema) }),
		z.object({ type: z.literal("blockquote"), children: z.array(blockNodeSchema) }),
		z.object({
			type: z.literal("list"),
			ordered: z.boolean(),
			start: z.number().nullable(),
			items: z.array(listItemSchema),
		}),
		z.object({
			type: z.literal("code"),
			id: z.string().nullable(),
			lang: z.string().nullable(),
			title: z.string().nullable(),
			showLineNumbers: z.boolean(),
			highlightLines: z.array(z.number().int().positive()),
			value: z.string(),
		}),
		z.object({
			type: z.literal("table"),
			id: z.string(),
			persist: z.boolean(),
			align: z.array(z.enum(["left", "center", "right"]).nullable()),
			head: z.array(z.array(inlineNodeSchema)),
			rows: z.array(z.array(z.array(inlineNodeSchema))),
		}),
		z.object({ type: z.literal("thematicBreak") }),
		z.object({
			type: z.literal("tabs"),
			id: z.string(),
			defaultValue: z.string(),
			tabs: z.array(tabNodeSchema),
		}),
		componentNodeSchema,
		elementNodeSchema,
		z.object({
			type: z.literal("footnoteDefinition"),
			label: z.string(),
			children: z.array(blockNodeSchema),
		}),
		z.object({
			type: z.literal("error"),
			id: z.string(),
			message: z.string(),
			source: z.string(),
		}),
	]),
);

export const documentTreeSchema: z.ZodType<DocumentTree> = z.object({
	schemaVersion: z.literal(DOCUMENT_SCHEMA_VERSION),
	metadata: docMetadataSchema,
	toc: z.array(tocEntrySchema),
	children: z.array(blockNodeSchema),
});
