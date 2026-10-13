import { describe, expect, it } from "vitest";
import { evaluate } from "@mdx-js/mdx";
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

	it("exports empty metadata when frontmatter is absent", async () => {
		const compiled = await evaluate(
			{ value: "# Body", path: `document.${extension}` },
			{ ...mdxCompileOptions(), ...runtime, useMDXComponents: () => ({}) },
		);
		expect(compiled.__mdxserveMetadata).toEqual({ openGraph: [] });
	});
});
