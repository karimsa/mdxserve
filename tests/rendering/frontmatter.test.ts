import { describe, expect, it } from "vitest";
import { evaluate } from "@mdx-js/mdx";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as runtime from "react/jsx-runtime";
import { mdxCompileOptions } from "../../src/rendering/mdx/mdx-options.js";
import { remarkSections } from "../../src/rendering/mdx/remark-sections.js";
import { validateSource } from "../../src/validation/validate.js";
import { fixtureRegistry } from "../fixtures/registry.js";

const metadata =
	'---\ntitle: "{not javascript}"\ncomponent: <Unregistered>\ntags:\n  - hidden-metadata\n---\n';

async function render(source: string, extension: string, sections = false): Promise<string> {
	const compiled = await evaluate(
		{ value: source, path: `frontmatter.${extension}` },
		{
			...mdxCompileOptions({ remarkPlugins: sections ? [remarkSections] : [] }),
			...runtime,
			useMDXComponents: () => ({}),
		},
	);
	return renderToStaticMarkup(
		createElement(compiled.default, {
			components: {
				MdSection: ({
					startLine,
					endLine,
					children,
				}: {
					startLine: string;
					endLine: string;
					children: React.ReactNode;
				}) => createElement("section", { "data-start": startLine, "data-end": endLine }, children),
			},
		}),
	);
}

describe.each(["md", "mdx"])("frontmatter in .%s documents", (extension) => {
	it("renders only the body, including when metadata contains JSX and braces", async () => {
		expect(await render(`${metadata}\n# Visible body\n`, extension)).toBe(
			'<h1 id="visible-body">Visible body</h1>',
		);
		expect(await render(metadata, extension)).toBe("");
	});

	it("preserves original editable body line numbers with CRLF input", async () => {
		const source = `${metadata}\n# Visible body\n`.replaceAll("\n", "\r\n");
		expect(await render(source, extension, true)).toContain('data-start="8" data-end="8"');
	});

	it("ignores metadata during validation but still diagnoses the body at its original line", async () => {
		const valid = await validateSource({
			source: `${metadata}\n# Body\n`,
			path: `doc.${extension}`,
			registry: fixtureRegistry,
		});
		expect(valid.diagnostics).toEqual([]);
		const invalid = await validateSource({
			source: `${metadata}\n<Unregistered />\n`,
			path: `doc.${extension}`,
			registry: fixtureRegistry,
		});
		expect(invalid.diagnostics).toEqual(
			expect.arrayContaining([expect.objectContaining({ line: 8, severity: "error" })]),
		);
	});

	it("keeps thematic breaks and frontmatter examples in the body visible", async () => {
		const source = "# Body\n\n---\n\nText\n\n```yaml\n---\ntitle: example\n---\n```\n";
		const html = await render(source, extension);
		expect(html).toContain("<hr/>");
		expect(html).toContain("example");
	});
});
