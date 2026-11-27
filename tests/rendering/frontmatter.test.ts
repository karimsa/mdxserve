import { createMetadataPort } from "../helpers/metadata.js";
import { describe, expect, it } from "vitest";
import { DocumentService } from "../../src/document/service.js";
import { validateSource } from "../../src/validation/validate.js";
import { fixtureRegistry } from "../fixtures/registry.js";

const metadata =
	'---\ntitle: "{not javascript}"\ncomponent: <Unregistered>\ntags:\n  - hidden-metadata\n---\n';

const documents = new DocumentService(fixtureRegistry, (relativePath) => relativePath);

function parse(source: string, extension: string) {
	return documents.parse(source, `/docs/frontmatter.${extension}`);
}

describe.each(["md", "mdx"])("frontmatter in .%s documents", (extension) => {
	it("keeps metadata out of the tree, including when it contains JSX and braces", () => {
		const parsed = parse(`${metadata}\n# Visible body\n`, extension);
		expect(parsed.diagnostics).toEqual([]);
		const text = JSON.stringify(parsed.tree.children);
		expect(text).toContain("Visible body");
		expect(text).not.toContain("hidden-metadata");
		expect(text).not.toContain("Unregistered");
		expect(JSON.stringify(parse(metadata, extension).tree.children)).not.toContain(
			"hidden-metadata",
		);
	});

	it("preserves original editable body line numbers with CRLF input", () => {
		const source = `${metadata}\n# Visible body\n`.replaceAll("\n", "\r\n");
		const parsed = parse(source, extension);
		expect([...parsed.ranges.values()]).toContainEqual({ startLine: 8, endLine: 8 });
	});

	it("ignores metadata during validation but still diagnoses the body at its original line", async () => {
		const valid = await validateSource({
			metadata: createMetadataPort(),
			source: `${metadata}\n# Body\n`,
			path: `doc.${extension}`,
			registry: fixtureRegistry,
		});
		expect(valid.diagnostics).toEqual([]);
		const invalid = await validateSource({
			metadata: createMetadataPort(),
			source: `${metadata}\n<Unregistered />\n`,
			path: `doc.${extension}`,
			registry: fixtureRegistry,
		});
		expect(invalid.diagnostics).toEqual(
			expect.arrayContaining([expect.objectContaining({ line: 8, severity: "error" })]),
		);
	});

	it("keeps thematic breaks and frontmatter examples in the body visible", () => {
		const source = "# Body\n\n---\n\nText\n\n```yaml\n---\ntitle: example\n---\n```\n";
		const parsed = parse(source, extension);
		const text = JSON.stringify(parsed.tree.children);
		expect(text).toContain("thematicBreak");
		expect(text).toContain("example");
	});
});
