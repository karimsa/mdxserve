import { describe, expect, it } from "vitest";
import { z } from "zod";
import { builtins } from "../../client/builtins";
import { slashBlocks } from "../../client/editor/blocks";
import { validateSource } from "../../src/validation/validate";
import type { Registry } from "../../src/components/registry";

const registry: Registry = {
	version: 1,
	components: builtins.map(({ name, description, whenToUse, props }) => {
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
