import { describe, expect, it } from "vitest";
import { validateSource } from "../../src/validation/validate.js";
import { fixtureRegistry } from "../fixtures/registry.js";
import { createMetadataPort } from "../helpers/metadata.js";

const cases = [
	{
		name: "GFM table and task list",
		source: "# Guide\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n- [x] done\n",
	},
	{ name: "builtin JSX", source: '<Callout tone="info">Hello</Callout>\n' },
	{ name: "a bare less-than sign", source: "# Sizing\n\nKeep width <800px.\n" },
	{
		name: "a multiline expression with a comparison",
		source:
			"export const values = [1, 2]\n\n{values.filter(\n  (value) => value < 10\n).map((value) => <span key={value}>{value}</span>)}\n\nWidth < 10\n",
	},
	{ name: "an unresolved import", source: 'import Widget from "./missing"\n\n<Widget />\n' },
	{ name: "malformed JSX", source: "<Callout>\n\nUnclosed\n" },
];

describe("Markdown extension parity", () => {
	it.each(cases)("validates $name the same way as .md and .mdx", async ({ source }) => {
		const metadata = createMetadataPort();
		const md = await validateSource({
			source,
			path: "/docs/page.md",
			registry: fixtureRegistry,
			metadata,
			resolveImport: () => false,
		});
		const mdx = await validateSource({
			source,
			path: "/docs/page.mdx",
			registry: fixtureRegistry,
			metadata,
			resolveImport: () => false,
		});
		expect({ ...mdx, path: md.path }).toEqual(md);
	});
});
