import { Node } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { fromMarkdown } from "mdast-util-from-markdown";
import { mdxFromMarkdown } from "mdast-util-mdx";
import { mdxjs } from "micromark-extension-mdxjs";
import { componentFields, updateComponentField } from "./component-fields";

function readFlowJsx(source: string): string | undefined {
	if (!/^ {0,3}</.test(source)) return;
	const parse = (candidate: string): string | undefined => {
		const tree = fromMarkdown(candidate, {
			extensions: [mdxjs()],
			mdastExtensions: [mdxFromMarkdown()],
		});
		const first = tree.children[0];
		if (
			first?.type !== "mdxJsxFlowElement" ||
			first.position?.start.offset === undefined ||
			first.position.start.offset > 3
		)
			return;
		const end = first.position.end.offset;
		return end === undefined ? undefined : source.slice(0, end);
	};
	try {
		return parse(source);
	} catch {
		// A later tolerant Markdown span can be invalid MDX. Parse only up to
		// the first complete JSX block, never requiring the rest to be valid.
		for (const match of source.matchAll(/\n/g)) {
			try {
				const block = parse(source.slice(0, match.index + 1));
				if (block) return block;
			} catch {
				// The component may still be open at this line boundary.
			}
		}
		return;
	}
}

/** Keep JSX in one atom so its children and JavaScript expressions never pass through Marked. */
function MdxBlockView({ node, updateAttributes }: NodeViewProps) {
	const source = node.attrs.source as string;
	const { name, fields } = componentFields(source);
	return (
		<NodeViewWrapper className="mdx-source-block" contentEditable={false}>
			<strong className="mdx-component-name">{name}</strong>
			<div className="mdx-component-fields">
				{fields.map((field) => (
					<label key={field.key}>
						<span>{field.label}</span>
						{field.kind === "boolean" ? (
							<input
								type="checkbox"
								checked={field.value === "true"}
								onChange={(event) =>
									updateAttributes({
										source: updateComponentField(source, field, String(event.target.checked)),
									})
								}
							/>
						) : field.kind === "content" ? (
							<textarea
								value={field.value}
								onChange={(event) =>
									updateAttributes({
										source: updateComponentField(source, field, event.target.value),
									})
								}
							/>
						) : (
							<input
								type={field.kind === "number" ? "number" : "text"}
								value={field.value}
								onChange={(event) =>
									updateAttributes({
										source: updateComponentField(source, field, event.target.value),
									})
								}
							/>
						)}
					</label>
				))}
			</div>
			<details open={fields.length === 0 ? true : undefined}>
				<summary>Advanced source</summary>
				<label>
					<span className="sr-only">MDX source</span>
					<textarea
						aria-label="MDX source"
						className="mdx-component-source"
						value={source}
						onChange={(event) => updateAttributes({ source: event.target.value })}
						spellCheck={false}
					/>
				</label>
			</details>
		</NodeViewWrapper>
	);
}

/** A block-level JSX element, preserved byte-for-byte while its section is edited. */
export const MdxBlock = Node.create({
	name: "mdxBlock",
	group: "block",
	atom: true,
	draggable: true,
	addAttributes() {
		return { source: { default: "" } };
	},
	parseHTML() {
		return [
			{
				tag: "div[data-mdx-block]",
				getAttrs: (element) => ({ source: element.getAttribute("data-source") ?? "" }),
			},
		];
	},
	renderHTML({ node }) {
		return ["div", { "data-mdx-block": "", "data-source": node.attrs.source as string }];
	},
	addNodeView() {
		return ReactNodeViewRenderer(MdxBlockView);
	},
	markdownTokenName: "mdxBlock",
	markdownTokenizer: {
		name: "mdxBlock",
		level: "block",
		start: (source) => source.search(/(^|\n) {0,3}</),
		tokenize: (source) => {
			const raw = readFlowJsx(source);
			return raw ? { type: "mdxBlock", raw, text: raw } : undefined;
		},
	},
	parseMarkdown: (token, helpers) => helpers.createNode("mdxBlock", { source: token.raw }),
	renderMarkdown: (node) => node.attrs?.source ?? "",
});
