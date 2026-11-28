import * as fc from "fast-check";
import type { BlockNode, DocumentTree, InlineNode } from "../document/tree-types";

const piece = fc.constantFrom("a", "b", "word", " ", "  ", "\n", "\t", "é", "x y", "-", "Alpha");
const textValue = fc.array(piece, { maxLength: 5 }).map((parts) => parts.join(""));

type Block = BlockNode;

interface Grammar {
	inline: InlineNode;
	block: Block;
	structural: Block;
}

const grammar = fc.letrec<Grammar>(
	(tie): { [Key in keyof Grammar]: fc.Arbitrary<Grammar[Key]> } => {
		const inline = tie("inline") as fc.Arbitrary<InlineNode>;
		const block = tie("block") as fc.Arbitrary<Block>;
		const structural = tie("structural") as fc.Arbitrary<Block>;
		const inlines = fc.array(inline, { maxLength: 3 });
		const paragraph = inlines.map((children): Block => ({ type: "paragraph", children }));
		return {
			inline: fc.oneof(
				{ depthSize: "small", withCrossShrink: true },
				textValue.map((value): InlineNode => ({ type: "text", value })),
				textValue.map((value): InlineNode => ({ type: "inlineCode", value })),
				fc.constant<InlineNode>({ type: "break" }),
				fc
					.constantFrom("one", "two")
					.map((label): InlineNode => ({ type: "footnoteReference", label })),
				inlines.map((children): InlineNode => ({ type: "emphasis", children })),
				inlines.map((children): InlineNode => ({ type: "strong", children })),
				inlines.map((children): InlineNode => ({ type: "delete", children })),
				inlines.map((children): InlineNode => ({
					type: "link",
					href: "/x",
					title: null,
					children,
				})),
				fc
					.record({ name: fc.constantFrom("Badge", "Kbd", "Other"), children: inlines })
					.map(({ name, children }): InlineNode => ({
						type: "component",
						id: null,
						name,
						props: {},
						children,
					})),
				textValue.map((value): InlineNode => ({
					type: "component",
					id: null,
					name: "Badge",
					props: { children: value },
					children: [],
				})),
			),
			block: fc.oneof(
				{ depthSize: "small", withCrossShrink: true },
				paragraph,
				fc
					.record({ lang: fc.constantFrom("ts", "mermaid", null), value: textValue })
					.map(({ lang, value }): Block => ({
						type: "code",
						id: null,
						lang,
						title: null,
						showLineNumbers: false,
						highlightLines: [],
						value,
					})),
				fc
					.array(fc.array(fc.oneof(paragraph, block), { minLength: 1, maxLength: 3 }), {
						minLength: 1,
						maxLength: 3,
					})
					.map((items): Block => ({
						type: "list",
						ordered: false,
						start: null,
						items: items.map((children) => ({ checked: null, children })),
					})),
				fc
					.array(block, { maxLength: 3 })
					.map((children): Block => ({ type: "blockquote", children })),
				fc
					.record({
						head: fc.array(inlines, { minLength: 1, maxLength: 3 }),
						rows: fc.array(fc.array(inlines, { minLength: 1, maxLength: 3 }), { maxLength: 3 }),
					})
					.map(({ head, rows }): Block => ({
						type: "table",
						id: "table",
						persist: false,
						align: [],
						head,
						rows,
					})),
				fc
					.array(fc.array(structural, { maxLength: 3 }), { minLength: 1, maxLength: 3 })
					.map((contents): Block => ({
						type: "tabs",
						id: "tabs",
						defaultValue: "0",
						tabs: contents.map((children, index) => ({
							id: `tabs>${index}`,
							value: String(index),
							label: String(index),
							children,
						})),
					})),
			),
			structural: fc.oneof(
				{ depthSize: "small", withCrossShrink: true },
				block,
				fc
					.record({ heading: inlines, children: fc.array(structural, { maxLength: 3 }) })
					.map(({ heading, children }): Block => ({
						type: "section",
						id: "section",
						level: 2,
						heading,
						children,
					})),
				fc
					.array(structural, { maxLength: 3 })
					.map((children): Block => ({ type: "preamble", id: "preamble", children })),
				fc.constantFrom("one", "two").map((label): Block => ({
					type: "footnoteDefinition",
					label,
					children: [{ type: "paragraph", children: [{ type: "text", value: "note" }] }],
				})),
			),
		};
	},
);

/** Generated document trees: sections, lists (tight, loose, nested), tabs, tables, code and inline markup. */
export const treeArbitrary: fc.Arbitrary<DocumentTree> = fc
	.array(grammar.structural, { maxLength: 5 })
	.map((children) => ({
		schemaVersion: 1,
		metadata: { openGraph: [] },
		toc: [],
		children,
	}));

/** Copy of the rule `apps/mobile/src/document/rows.ts` `documentRows` draws list rows by. */
export function rowNodes(tree: DocumentTree): Set<object> {
	const found = new Set<object>();
	function add(nodes: readonly BlockNode[]): void {
		for (const node of nodes) {
			if (node.type === "section") {
				found.add(node);
				add(node.children);
			} else if (node.type === "preamble") add(node.children);
			else if (node.type !== "footnoteDefinition") found.add(node);
		}
	}
	add(tree.children);
	return found;
}
