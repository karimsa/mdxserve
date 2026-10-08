import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { createProcessor } from "@mdx-js/mdx";
import { mdxCompileOptions } from "../../src/rendering/mdx/mdx-options.js";
import { toString as mdastToString } from "mdast-util-to-string";
import type { Root, RootContent } from "mdast";
import type { MdxJsxFlowElement } from "mdast-util-mdx";
import { remarkSections } from "../../src/rendering/mdx/remark-sections.js";

// Use the same syntax extensions as rendering and validation.
function parse(src: string): Root {
	return createProcessor({ ...mdxCompileOptions(), format: "mdx" }).parse(src) as Root;
}

function runPlugin(src: string): Root {
	const tree = parse(src);
	remarkSections()(tree);
	return tree;
}

function isMdSection(node: RootContent): node is MdxJsxFlowElement {
	return node.type === "mdxJsxFlowElement" && node.name === "MdSection";
}

function attrValue(section: MdxJsxFlowElement, name: string): string {
	const found = section.attributes.find(
		(attribute) => attribute.type === "mdxJsxAttribute" && attribute.name === name,
	);
	if (!found || found.type !== "mdxJsxAttribute" || typeof found.value !== "string") {
		throw new Error(`MdSection missing string attribute "${name}"`);
	}
	return found.value;
}

function collectDescendants(node: RootContent): RootContent[] {
	const acc: RootContent[] = [];
	function visit(current: RootContent): void {
		acc.push(current);
		if ("children" in current && Array.isArray(current.children)) {
			for (const child of current.children as RootContent[]) visit(child);
		}
	}
	visit(node);
	return acc;
}

const FORBIDDEN_TYPES = new Set([
	"html",
	"definition",
	"footnoteDefinition",
	"footnoteReference",
	"linkReference",
	"imageReference",
]);

// ---- Block vocabulary ---------------------------------------------------
// A small mix of pure-markdown blocks (editable) and MDX-flavoured blocks
// (never editable), joined with blank lines like tests/validate.property.test.ts's
// docArb, but broader: it must also reach JSX flow blocks, ESM, and inline
// JSX/expressions inside a paragraph, since those are exactly what the
// allow-list is supposed to exclude.

const words = fc
	.array(fc.stringMatching(/^[a-z]{1,8}$/), { minLength: 1, maxLength: 6 })
	.map((chosen) => chosen.join(" "));

const paragraphArb = words;
const headingArb = fc
	.tuple(fc.integer({ min: 1, max: 3 }), words)
	.map(([level, text]) => `${"#".repeat(level)} ${text}`);
const listArb = fc
	.array(words, { minLength: 1, maxLength: 4 })
	.map((items) => items.map((item) => `- ${item}`).join("\n"));
const fenceArb = fc
	.tuple(fc.stringMatching(/^[A-Za-z0-9_-]*$/, { maxLength: 8 }), words)
	.map(([lang, body]) => ["```" + lang, body, "```"].join("\n"));
const cellArb = fc.stringMatching(/^[a-z]{1,8}$/);
const tableArb = fc
	.array(fc.tuple(cellArb, cellArb), { minLength: 1, maxLength: 3 })
	.map((rows) => {
		const header = "| a | b |";
		const sep = "| --- | --- |";
		const body = rows.map(([first, second]) => `| ${first} | ${second} |`).join("\n");
		return [header, sep, body].join("\n");
	});
// Keep generated body rules unambiguous with document-level YAML fences.
const thematicBreakArb = fc.constant("***");
const jsxBlockArb = fc.constant('<Callout tone="info">\n\ntext\n\n</Callout>');
const esmArb = fc.constant('import X from "./x"');
const inlineJsxParagraphArb = words.map((word) => `${word} <Badge>x</Badge>`);
const inlineExprParagraphArb = words.map((word) => `${word} {1 + 1}`);

const blockArb = fc.oneof(
	paragraphArb,
	headingArb,
	listArb,
	fenceArb,
	tableArb,
	thematicBreakArb,
	jsxBlockArb,
	esmArb,
	inlineJsxParagraphArb,
	inlineExprParagraphArb,
);

// Occasionally prepend a frontmatter-shaped block; `minLength: 0` above and
// here together reach the empty doc. Every `esmArb` block renders the same
// literal `import X from "./x"` text, and two identical top-level imports in
// one document are a genuine acorn "Identifier 'X' has already been
// declared" parse error (unrelated to remarkSections) — so disambiguate by
// position before joining.
const docArb = fc
	.tuple(fc.boolean(), fc.array(blockArb, { minLength: 0, maxLength: 6 }))
	.map(([withFrontmatter, blocks]) => {
		const disambiguated = blocks.map((block, index) =>
			block.startsWith("import ") ? `import X${index} from "./x${index}"` : block,
		);
		const parts = withFrontmatter ? ["---\ntitle: x\n---", ...disambiguated] : disambiguated;
		return parts.join("\n\n");
	});

describe("remarkSections — invariance", () => {
	it("flattening every MdSection's children back in place reproduces the original children", () => {
		fc.assert(
			fc.property(docArb, (src) => {
				const tree = parse(src);
				const original = structuredClone(tree.children);
				remarkSections()(tree);
				const flattened = tree.children.flatMap((node): RootContent[] =>
					isMdSection(node) ? (node.children as RootContent[]) : [node],
				);
				expect(flattened).toEqual(original);
			}),
		);
	});

	it("no MdSection subtree contains an mdx* node, html, definition, footnote*, linkReference, or imageReference", () => {
		fc.assert(
			fc.property(docArb, (src) => {
				const tree = runPlugin(src);
				for (const node of tree.children) {
					if (!isMdSection(node)) continue;
					for (const child of node.children as RootContent[]) {
						for (const descendant of collectDescendants(child)) {
							expect(descendant.type.startsWith("mdx")).toBe(false);
							expect(FORBIDDEN_TYPES.has(descendant.type)).toBe(false);
						}
					}
				}
			}),
		);
	});

	it("two MdSections are never adjacent unless the second starts with a heading of depth <= 2", () => {
		fc.assert(
			fc.property(docArb, (src) => {
				const tree = runPlugin(src);
				for (let index = 0; index + 1 < tree.children.length; index++) {
					const current = tree.children[index];
					const next = tree.children[index + 1];
					if (!isMdSection(current) || !isMdSection(next)) continue;
					const firstChild = next.children[0] as RootContent | undefined;
					const startsWithSmallHeading = firstChild?.type === "heading" && firstChild.depth <= 2;
					expect(startsWithSmallHeading).toBe(true);
				}
			}),
		);
	});

	it("ranges are ascending/non-overlapping and index attributes count 0..n-1 in order", () => {
		fc.assert(
			fc.property(docArb, (src) => {
				const tree = runPlugin(src);
				const sections = tree.children.filter(isMdSection);
				let prevEnd = -Infinity;
				sections.forEach((section, index) => {
					const start = Number(attrValue(section, "startLine"));
					const end = Number(attrValue(section, "endLine"));
					expect(start).toBeLessThanOrEqual(end);
					expect(start).toBeGreaterThan(prevEnd);
					prevEnd = end;
					expect(attrValue(section, "index")).toBe(String(index));
				});
			}),
		);
	});
});

describe("remarkSections — oracle", () => {
	it("slicing the source at [startLine, endLine] and re-parsing reproduces the section's text", () => {
		fc.assert(
			fc.property(docArb, (src) => {
				const tree = runPlugin(src);
				const lines = src.split("\n");
				for (const section of tree.children.filter(isMdSection)) {
					const start = Number(attrValue(section, "startLine"));
					const end = Number(attrValue(section, "endLine"));
					const slice = lines.slice(start - 1, end).join("\n");
					// Preserve document-start parsing only for sections that actually start there.
					const reparsed = parse(start === 1 ? slice : `\n${slice}`);
					expect(mdastToString(reparsed)).toBe(
						mdastToString({ type: "root", children: section.children } as Root),
					);
				}
			}),
		);
	});
});

describe("remarkSections — examples", () => {
	it("a doc starting with `---` on line 1 has no section starting at line 1", () => {
		const src = "---\ntitle: x\n---\n\nSome text here.\n";
		const tree = runPlugin(src);
		for (const section of tree.children.filter(isMdSection)) {
			expect(attrValue(section, "startLine")).not.toBe("1");
		}
	});

	it("a doc that opens with an unambiguous horizontal rule stays editable from line 1", () => {
		const src = "***\n\nIntro paragraph.\n\n---\n\nMore text.\n";
		const tree = runPlugin(src);
		const first = tree.children.find(isMdSection);
		expect(first && attrValue(first, "startLine")).toBe("1");
	});

	it("an unclosed leading `---` is not front matter: the doc stays editable", () => {
		const src = "---\nnot: closed\n\nBody paragraph.\n";
		const tree = runPlugin(src);
		expect(tree.children.some(isMdSection)).toBe(true);
	});

	// Metadata must never enter an editable section, including lists and blank lines.
	it("property: no section covers any front-matter line, whatever the block's shape", () => {
		const yamlLine = fc
			.tuple(fc.stringMatching(/^[a-z]{1,8}$/), fc.stringMatching(/^[a-z0-9 ]{1,12}$/))
			.map(([key, value]) => `${key}: ${value}`);
		const yamlList = fc
			.tuple(
				fc.stringMatching(/^[a-z]{1,8}$/),
				fc.array(fc.stringMatching(/^[a-z]{1,8}$/), { minLength: 1, maxLength: 3 }),
			)
			.map(([key, items]) => [`${key}:`, ...items.map((item) => `  - ${item}`)].join("\n"));
		const frontMatter = fc
			.array(fc.oneof(yamlLine, yamlList), { minLength: 1, maxLength: 4 })
			.map((entries) => ["---", ...entries, "---"].join("\n"));
		const body = fc
			.array(fc.stringMatching(/^[a-z ]{1,20}$/), { minLength: 0, maxLength: 3 })
			.map((paras) => paras.join("\n\n"));

		fc.assert(
			fc.property(frontMatter, body, (fm, text) => {
				const src = `${fm}\n\n${text}\n`;
				const fmLines = fm.split("\n").length;
				const tree = runPlugin(src);
				for (const section of tree.children.filter(isMdSection)) {
					expect(Number(attrValue(section, "startLine"))).toBeGreaterThan(fmLines);
				}
			}),
			{ numRuns: 200 },
		);
	});

	it("heading+paragraph, then a JSX block, then a trailing paragraph yields exactly two sections", () => {
		const src = "# T\n\npara\n\n<Callout>\n\nx\n\n</Callout>\n\npara2\n";
		const tree = runPlugin(src);
		const sections = tree.children.filter(isMdSection);
		expect(sections).toHaveLength(2);
		expect(attrValue(sections[0], "startLine")).toBe("1");
		expect(attrValue(sections[0], "endLine")).toBe("3");
		expect(attrValue(sections[1], "startLine")).toBe("11");
		expect(attrValue(sections[1], "endLine")).toBe("11");
	});
});
