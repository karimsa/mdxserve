import type { Program } from "estree";
import { fromMarkdown } from "mdast-util-from-markdown";
import { mdxFromMarkdown, type MdxFlowExpression } from "mdast-util-mdx";
import { mdxjs } from "micromark-extension-mdxjs";
import type { Root } from "mdast";

/** Parse `source` the way the document pipeline does (MDX, so JSX, ESM and expressions attach an ESTree). */
export function parseMdx(source: string): Root {
	return fromMarkdown(source, { extensions: [mdxjs()], mdastExtensions: [mdxFromMarkdown()] });
}

/** The ESTree program MDX attaches to the brace expression `{expression}`. */
export function programOf(expression: string): Program {
	const tree = parseMdx(`{${expression}}`);
	const node = tree.children[0] as MdxFlowExpression | undefined;
	if (node?.type !== "mdxFlowExpression" || !node.data?.estree) {
		throw new Error(`not a flow expression: ${expression}`);
	}
	return node.data.estree;
}
