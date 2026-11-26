import type { Parent, Root, RootContent } from "mdast";

/**
 * Lift a paragraph that holds only inline JSX (and whitespace) into flow JSX,
 * the way `@mdx-js/mdx`'s `remarkMarkAndUnravel` does before rendering, so
 * `<Tabs>\n  <Tab label="A">a</Tab>\n</Tabs>` gives `Tabs` two `Tab` children
 * rather than one paragraph. Mutates `tree`.
 */
export function unravelJsxParagraphs(tree: Root): void {
	visit(tree);
}

function visit(parent: Parent): void {
	const next: RootContent[] = [];
	for (const child of parent.children as RootContent[]) {
		if (child.type === "paragraph" && onlyJsx(child.children)) {
			for (const inline of child.children) {
				if (inline.type === "text" && /^[\t\r\n ]+$/.test(inline.value)) continue;
				if (inline.type === "mdxJsxTextElement") {
					(inline as unknown as { type: string }).type = "mdxJsxFlowElement";
				}
				next.push(inline as RootContent);
			}
			continue;
		}
		next.push(child);
	}
	parent.children = next as Parent["children"];
	for (const child of next) {
		if ("children" in child) visit(child as Parent);
	}
}

function onlyJsx(children: readonly RootContent[]): boolean {
	let oneOrMore = false;
	for (const child of children) {
		if (child.type === "mdxJsxTextElement" || child.type === "mdxTextExpression") oneOrMore = true;
		else if (child.type === "text" && /^[\t\n\f\r ]*$/.test(child.value)) continue;
		else return false;
	}
	return oneOrMore;
}
