import { describe, expect, it } from "vitest";
import { compile, evaluate } from "@mdx-js/mdx";
import * as runtime from "react/jsx-runtime";
import { mdxCompileOptions } from "../../src/rendering/mdx/mdx-options.js";

const source = `---
title: 'A "quoted" title'
description: 'An <unsafe> & detailed description'
openGraph:
  - property: og:image
    content: https://example.com/first.png
  - property: og:image:alt
    content: First image
  - property: og:image
    content: https://example.com/second.png
---

# Visible body
`;

describe.each(["md", "mdx"])("metadata compiler for .%s", (extension) => {
	it("exports normalized ordered metadata without executable source", async () => {
		const compiled = await evaluate(
			{ value: source, path: `document.${extension}` },
			{ ...mdxCompileOptions(), ...runtime, useMDXComponents: () => ({}) },
		);
		expect(compiled.__mdxserveMetadata).toEqual({
			title: 'A "quoted" title',
			description: "An <unsafe> & detailed description",
			openGraph: [
				{ property: "og:image", content: "https://example.com/first.png" },
				{ property: "og:image:alt", content: "First image" },
				{ property: "og:image", content: "https://example.com/second.png" },
			],
		});
	});

	it.each([
		"export const __mdxserveMetadata = {};",
		"export function __mdxserveMetadata() {}",
		"export class __mdxserveMetadata {}",
		"export default function __mdxserveMetadata() {}",
		"export const { nested: [__mdxserveMetadata = {}] } = { nested: [] };",
		'import __mdxserveMetadata from "./metadata.js";',
		'import * as __mdxserveMetadata from "./metadata.js";',
		'import { value as __mdxserveMetadata } from "./metadata.js";',
		'export { value as __mdxserveMetadata } from "./metadata.js";',
		'export * as __mdxserveMetadata from "./metadata.js";',
		'export * as "__mdxserveMetadata" from "./metadata.js";',
		'export { value as "__mdxserveMetadata" } from "./metadata.js";',
		"export const value = {}; export { value as __mdxserveMetadata };",
	])("reports the reserved metadata name for %s", async (declaration) => {
		await expect(
			compile(
				{ value: `${source}\n${declaration}\n`, path: `document.${extension}` },
				mdxCompileOptions(),
			),
		).rejects.toMatchObject({
			source: "mdxserve",
			ruleId: "reserved-metadata-export",
			reason:
				"__mdxserveMetadata is reserved for mdxserve page metadata; rename this binding or export.",
		});
	});

	it("allows the metadata name in nested scopes and object properties", async () => {
		const compiled = await evaluate(
			{
				value: `${source}\nexport const custom = { __mdxserveMetadata: true };\n\nexport function nested(__mdxserveMetadata) { return __mdxserveMetadata; }\n`,
				path: `document.${extension}`,
			},
			{ ...mdxCompileOptions(), ...runtime, useMDXComponents: () => ({}) },
		);
		expect(compiled.__mdxserveMetadata).toMatchObject({ title: 'A "quoted" title' });
		expect(compiled.custom).toEqual({ __mdxserveMetadata: true });
	});

	it("exports empty metadata when frontmatter is absent", async () => {
		const compiled = await evaluate(
			{ value: "# Body", path: `document.${extension}` },
			{ ...mdxCompileOptions(), ...runtime, useMDXComponents: () => ({}) },
		);
		expect(compiled.__mdxserveMetadata).toEqual({ openGraph: [] });
	});

	it("exports metadata from CR-only frontmatter", async () => {
		const compiled = await evaluate(
			{ value: "---\rtitle: CR title\r---\r# Body", path: `document.${extension}` },
			{ ...mdxCompileOptions(), ...runtime, useMDXComponents: () => ({}) },
		);
		expect(compiled.__mdxserveMetadata).toEqual({ title: "CR title", openGraph: [] });
	});
});
