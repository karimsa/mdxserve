import { describe, expect, it } from "vitest";
import { MAX_METADATA_PREFIX_BYTES, parseMetadata } from "../../src/docs/metadata.js";
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

	it("accepts a closing fence at EOF with BOM and CRLF", () => {
		expect(parseMetadata("\uFEFF---\r\ntitle: At EOF\r\n---")).toEqual({
			metadata: { title: "At EOF", openGraph: [] },
			diagnostics: [],
		});
	});

	it.each([
		"\uFEFF---\rtitle: CR only\r---\r# Body",
		"\uFEFF---\r\ntitle: CR only\r---\n# Body",
		"\uFEFF---\ntitle: CR only\r\n---\r# Body",
		"\uFEFF---\rtitle: CR only\r---",
	])("parses CR and mixed-newline frontmatter: %j", (source) => {
		expect(parseMetadata(source)).toEqual({
			metadata: { title: "CR only", openGraph: [] },
			diagnostics: [],
		});
	});

	it("finds a CR closing fence in a truncated metadata prefix", () => {
		const source = `---\rtitle: In prefix\r---\r${"x".repeat(MAX_METADATA_PREFIX_BYTES)}`;
		expect(parseMetadata(source, true)).toEqual({
			metadata: { title: "In prefix", openGraph: [] },
			diagnostics: [],
		});
	});

	it("accepts empty frontmatter before a large body", () => {
		expect(parseMetadata(`---\n---\n${"x".repeat(100_000)}`)).toEqual({
			metadata: { openGraph: [] },
			diagnostics: [],
		});
	});

	it("accepts YAML at the 64 KiB boundary and warns above it", () => {
		const titlePrefix = "title: ";
		const withinLimit = `---\n${titlePrefix}${"a".repeat(64 * 1024 - titlePrefix.length)}\n---`;
		const tooLarge = `---\n${titlePrefix}${"a".repeat(64 * 1024 - titlePrefix.length + 1)}\n---`;
		expect(parseMetadata(withinLimit).metadata.title).toHaveLength(64 * 1024 - titlePrefix.length);
		expect(parseMetadata(tooLarge).diagnostics[0]?.message).toContain("64 KiB");
	});

	it("stops scanning an oversized opening before the body", () => {
		const oversized = `---\ntitle: ${"a".repeat(MAX_METADATA_PREFIX_BYTES)}\n---\n`;
		expect(parseMetadata(oversized).diagnostics[0]?.message).toContain("64 KiB");
		expect(
			parseMetadata(`---\ntitle: ${"é".repeat(33_000)}\n---`).diagnostics[0]?.message,
		).toContain("64 KiB");
		expect(
			parseMetadata(`---${" ".repeat(MAX_METADATA_PREFIX_BYTES)}`).diagnostics[0]?.message,
		).toContain("64 KiB");
		expect(
			parseMetadata(`---\ntitle: fine\n---${" ".repeat(MAX_METADATA_PREFIX_BYTES)}`).metadata,
		).toEqual({
			openGraph: [],
		});
		expect(parseMetadata("--- invalid\ntitle: ignored\n---").diagnostics).toEqual([]);
		expect(parseMetadata("---\ntitle: unclosed\n# body")).toEqual({
			metadata: { openGraph: [] },
			diagnostics: [],
		});
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
