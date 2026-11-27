import { describe, expect, it } from "vitest";
import { z } from "zod";
import { builtinPropSchemas } from "@mdxserve/shared/builtins";
import { builtinCatalog } from "../src/builtins/catalog";
import { slashBlocks } from "../src/editor/blocks";
import { validateSource } from "@karimsa/mdxserve/src/validation/validate";
import type { Registry } from "@karimsa/mdxserve/src/components/registry";
import { createMetadataPort } from "@karimsa/mdxserve/tests/helpers/metadata";

const registry: Registry = {
	version: 1,
	components: builtinCatalog.map(({ name, description, whenToUse }) => {
		const props = builtinPropSchemas[name];
		const hasChildren = "children" in props.shape;
		const schema = hasChildren ? props.omit({ children: true }) : props;
		return {
			name,
			description,
			whenToUse,
			props: z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }),
		};
	}),
};

describe("component slash templates", () => {
	it.each(["md", "mdx"])("compile and pass builtin validation in .%s", async (extension) => {
		for (const block of slashBlocks.filter((item) => item.kind === "component")) {
			const result = await validateSource({
				metadata: createMetadataPort(),
				source: block.template!,
				path: `example.${extension}`,
				registry,
			});
			expect(result.diagnostics, `${block.label}: ${JSON.stringify(result.diagnostics)}`).toEqual(
				[],
			);
		}
	});
});
