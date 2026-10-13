import { describe, expect, it } from "vitest";
import { parseMetadata } from "../../src/docs/metadata.js";
import fc from "fast-check";

describe("frontmatter metadata", () => {
	it.each(["md", "mdx"])("normalizes ordered and repeated Open Graph values for .%s", () => {
		const source = `---
title: Example
description: A page
canonical: https://example.com/page
otherField: [kept, for, others]
openGraph:
  - property: og:image
    content: https://example.com/one.jpg
  - property: og:image:width
    content: 640
  - property: og:image
    content: https://example.com/two.jpg
  - property: og:site_name
    content: Example site
  - property: og:image:secure_url
    content: https://example.com/secure.jpg
  - property: og:locale:alternate
    content: fr_CA
---
# Body`;
		expect(parseMetadata(source)).toEqual({
			metadata: {
				title: "Example",
				description: "A page",
				canonical: "https://example.com/page",
				openGraph: [
					{ property: "og:image", content: "https://example.com/one.jpg" },
					{ property: "og:image:width", content: "640" },
					{ property: "og:image", content: "https://example.com/two.jpg" },
					{ property: "og:site_name", content: "Example site" },
					{ property: "og:image:secure_url", content: "https://example.com/secure.jpg" },
					{ property: "og:locale:alternate", content: "fr_CA" },
				],
			},
			diagnostics: [],
		});
	});

	it.each([
		["# Body\n---\ntitle: hidden\n---", false],
		["```yaml\n---\ntitle: hidden\n---\n```", false],
		["---\ntitle: hidden\n# Unclosed", false],
		["---\ntitle: shown\n---\n# Body", true],
	])("uses the actual leading YAML boundary", (source, hasTitle) => {
		expect(parseMetadata(source).metadata.title === "shown").toBe(hasTitle);
	});

	it.each([
		"canonical: javascript:alert(1)",
		"title: [not, a, string]",
		"openGraph:\n  - property: og:image\n    content: ./relative.png",
		"openGraph:\n  - property: title\n    content: wrong",
		"title: first\ntitle: second",
		"title: &value Example\ndescription: *value",
		"title: !custom Example",
	])("falls back with original YAML location for invalid metadata: %s", (yaml) => {
		const result = parseMetadata(`---\n${yaml}\n---\n# Body`);
		expect(result.metadata).toEqual({ openGraph: [] });
		expect(result.diagnostics[0]).toMatchObject({
			severity: "warning",
			code: "frontmatter-metadata",
			line: expect.any(Number),
			column: expect.any(Number),
		});
	});

	it("bounds metadata parsing even when the document body is much larger", () => {
		const result = parseMetadata(`---\ntitle: ${"x".repeat(70_000)}\n---`);
		expect(result.metadata).toEqual({ openGraph: [] });
		expect(result.diagnostics).toHaveLength(1);
	});

	it("preserves valid scalar titles without creating Open Graph defaults", () => {
		fc.assert(
			fc.property(fc.stringMatching(/^[A-Za-z0-9 _-]{1,40}$/), (title) => {
				const result = parseMetadata(`---\ntitle: ${JSON.stringify(title)}\n---\n# Body`);
				expect(result).toEqual({ metadata: { title, openGraph: [] }, diagnostics: [] });
			}),
		);
	});
});
