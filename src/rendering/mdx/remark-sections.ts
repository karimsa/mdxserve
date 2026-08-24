import type { Root, RootContent } from "mdast";
import type { MdxJsxAttribute, MdxJsxFlowElement } from "mdast-util-mdx";

// Every node type a section is allowed to contain, recursively. Deliberately
// excludes anything MDX-flavoured (mdxJsxFlowElement, mdxJsxTextElement,
// mdxjsEsm, mdxFlowExpression, mdxTextExpression) and the handful of mdast
// node types Tiptap/the round-trip serializer has no story for (raw `html`,
// `definition`/`*Reference` link and footnote plumbing). A single paragraph
// containing an inline `<Badge/>` or `{expr}` is therefore never editable,
// even though the paragraph itself would otherwise qualify.
const EDITABLE_TYPES = new Set([
	"paragraph",
	"heading",
	"list",
	"listItem",
	"blockquote",
	"code",
	"thematicBreak",
	"table",
	"tableRow",
	"tableCell",
	"text",
	"emphasis",
	"strong",
	"delete",
	"inlineCode",
	"link",
	"image",
	"break",
]);

// Mirrors the recursive shape of `hasMdxNode` in src/docs/doc-cache.ts:22-24, but as an
// allow-list walk instead of a deny-list one: a node qualifies only if its
// own type is editable *and* every descendant (recursively) also is.
function isEditable(node: RootContent): boolean {
	if (!EDITABLE_TYPES.has(node.type)) return false;
	if ("children" in node && Array.isArray(node.children)) {
		return (node.children as RootContent[]).every(isEditable);
	}
	return true;
}

/**
 * How many leading children make up a front matter block (0 when there is
 * none). See the comment at the call site for the shapes this covers.
 */
function frontmatterExtent(children: RootContent[]): number {
	const first = children[0];
	if (!first || first.type !== "thematicBreak" || first.position?.start.line !== 1) return 0;
	// Front matter content sits flush under the opening rule. A plain
	// horizontal rule at the top of a doc is followed by a blank line, so its
	// next node starts on line 3 or later — leave that doc fully editable.
	if (children[1]?.position?.start.line !== 2) return 0;
	for (let i = 1; i < children.length; i++) {
		const node = children[i];
		if (node.type === "thematicBreak") return i + 1;
		// A setext heading directly after the opening rule: its underline is
		// the closing `---`, so the block ends with it.
		if (node.type === "heading" && i === 1) return 2;
	}
	// Never closed, so not front matter: an ordinary rule at the top of an
	// ordinary doc.
	return 0;
}

function attr(name: string, value: string): MdxJsxAttribute {
	return { type: "mdxJsxAttribute", name, value };
}

/**
 * Wrap every maximal run of pure-markdown top-level nodes in a synthetic
 * `<MdSection index startLine endLine>` element, so the client can offer
 * per-section Tiptap editing without ever exposing JSX/ESM to a WYSIWYG
 * editor. Runs are split before any non-editable node and before any `h1`/`h2`
 * heading (so sections line up with the document's visual section
 * boundaries and stay reasonably small).
 *
 * This is a *user* remark plugin (registered only in src/rendering/vite.ts, never in
 * src/rendering/mdx/mdx-options.ts): it runs after remarkMarkAndUnravel, so MDX node types
 * are already settled, and it must never be visible to validateSource's
 * compiler options, or every doc would fail with an "unregistered MdSection"
 * diagnostic.
 */
export function remarkSections() {
	return (tree: Root): void => {
		const children = tree.children;

		// No remark-frontmatter in the pipeline, so a leading `---` block parses
		// as ordinary Markdown: `---\nkey: v\n---` becomes a thematicBreak plus a
		// setext heading (the closing `---` is the heading underline), while a
		// multi-line block like `---\ntags:\n  - a\n---` becomes a thematicBreak,
		// a paragraph, a list and a second thematicBreak. Either way it would
		// look perfectly editable, and opening it in the editor would rewrite
		// the metadata. Skip everything from the line-1 rule through whatever
		// closes it: the next thematicBreak, or a setext heading whose
		// underline is the closing `---`.
		const frontmatterEnd = frontmatterExtent(children);

		const result: RootContent[] = [];
		let run: RootContent[] = [];
		let sectionIndex = 0;

		function flush(): void {
			if (run.length === 0) return;
			const first = run[0];
			const last = run[run.length - 1];

			// A section wrapper needs a source range to be useful (the client
			// slices raw file lines by it); if any node in the run somehow lacks
			// position info, push the run through unwrapped rather than losing it
			// or fabricating a range.
			const hasFullPositions = run.every((n) => n.position !== undefined);
			if (!hasFullPositions || !first.position || !last.position) {
				result.push(...run);
				run = [];
				return;
			}

			const section: MdxJsxFlowElement = {
				type: "mdxJsxFlowElement",
				name: "MdSection",
				attributes: [
					attr("index", String(sectionIndex)),
					attr("startLine", String(first.position.start.line)),
					attr("endLine", String(last.position.end.line)),
				],
				children: run as MdxJsxFlowElement["children"],
				position: { start: first.position.start, end: last.position.end },
			};
			sectionIndex += 1;
			result.push(section);
			run = [];
		}

		children.forEach((node, i) => {
			const editable = i >= frontmatterEnd && isEditable(node);
			if (!editable) {
				flush();
				result.push(node);
				return;
			}
			// depth <= 2 headings start a new run even when the run so far is
			// still editable, so sections track the document's h1/h2 structure.
			if (node.type === "heading" && node.depth <= 2) flush();
			run.push(node);
		});
		flush();

		tree.children = result as Root["children"];
	};
}
