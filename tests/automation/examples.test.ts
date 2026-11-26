import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { builtins } from "../../client/builtins/index.js";
import type { Registry } from "../../src/components/registry.js";
import { getPackageRoot } from "../../src/infra/pkg.js";
import { validateSource } from "../../src/validation/validate.js";
import { createMetadataPort } from "../helpers/metadata.js";

// The real builtin registry, built the way scripts/build-registry.ts builds
// dist/registry.json, so this test needs no build step.
const registry: Registry = {
	version: 1,
	components: builtins.map(({ name, description, whenToUse, props }) => {
		const schema = "children" in props.shape ? props.omit({ children: true }) : props;
		return {
			name,
			description,
			whenToUse,
			props: z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }),
		};
	}),
};

const exampleDir = path.join(getPackageRoot(), "example");
const examples = fs
	.readdirSync(exampleDir, { recursive: true, encoding: "utf8" })
	.filter((file) => /\.mdx?$/.test(file))
	.sort();

describe("example/", () => {
	it("has documents to check", () => {
		expect(examples.length).toBeGreaterThan(0);
	});

	it.each(examples)("%s passes validation with no diagnostics", async (file) => {
		const abs = path.join(exampleDir, file);
		const result = await validateSource({
			metadata: createMetadataPort(),
			source: fs.readFileSync(abs, "utf8"),
			path: abs,
			registry,
		});
		expect(result.diagnostics).toEqual([]);
		expect(result.ok).toBe(true);
	});
});
