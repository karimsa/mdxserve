import { Node } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { fromMarkdown } from "mdast-util-from-markdown";
import { mdxFromMarkdown } from "mdast-util-mdx";
import { mdxjs } from "micromark-extension-mdxjs";
import type { Root, RootContent } from "mdast";
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

/** A fence line with more than a language after the backticks: `title`, `showLineNumbers`, `{3-4}`. */
const FENCE_WITH_META = /^ {0,3}(?:`{3,}|~{3,})[ \t]*[^\s`]+[ \t]+\S/;

function parseMdx(source: string): Root {
	return fromMarkdown(source, { extensions: [mdxjs()], mdastExtensions: [mdxFromMarkdown()] });
}

function containsInlineMdx(node: RootContent): boolean {
	if (
		node.type === "mdxJsxTextElement" ||
		node.type === "mdxTextExpression" ||
		node.type === "mdxJsxFlowElement" ||
		node.type === "mdxFlowExpression" ||
		node.type === "html"
	)
		return true;
	return "children" in node && (node.children as RootContent[]).some(containsInlineMdx);
}

/**
 * A Markdown block Tiptap would change on a load and save with no edit: one
 * holding an inline component, a literal in braces or raw HTML (Marked escapes
 * or drops them), or a code fence with meta (the title, line numbers and
 * highlighted lines are lost). A section edit covers whole sections, so these
 * stay raw source, byte for byte, like flow JSX does.
 * @internal Exported for its tests.
 */
export function readLossyBlock(source: string): string | undefined {
	const blankLine = source.search(/\n[ \t]*\n/);
	const head = blankLine === -1 ? source : source.slice(0, blankLine);
	if (!/[<{]/.test(head) && !FENCE_WITH_META.test(head)) return;
	let tree: Root;
	try {
		tree = parseMdx(source);
	} catch {
		try {
			tree = parseMdx(head);
		} catch {
			return;
		}
	}
	const first = tree.children[0];
	const start = first?.position?.start.offset;
	const end = first?.position?.end.offset;
	if (!first || start === undefined || end === undefined || source.slice(0, start).trim() !== "")
		return;
	const lossy =
		first.type === "code" ? Boolean(first.meta) : containsInlineMdx(first as RootContent);
	return lossy ? source.slice(0, end) : undefined;
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
			const raw = readFlowJsx(source) ?? readLossyBlock(source);
			return raw ? { type: "mdxBlock", raw, text: raw } : undefined;
		},
	},
	parseMarkdown: (token, helpers) => helpers.createNode("mdxBlock", { source: token.raw }),
	renderMarkdown: (node) => node.attrs?.source ?? "",
});
