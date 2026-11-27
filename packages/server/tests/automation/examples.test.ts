import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getPackageRoot } from "../../src/infra/pkg.js";
import { validateSource } from "../../src/validation/validate.js";
import { builtinRegistry as registry } from "../helpers/components.js";
import { createMetadataPort } from "../helpers/metadata.js";
import { runDocument } from "../../src/cli/document.js";
import { documentTreeSchema } from "../../src/document/schema.js";

// The real builtin prop schemas (tests/helpers/components.ts), so this test needs no build step.
const exampleDir = path.join(getPackageRoot(), "../../example");
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

	it.each(examples)(
		"%s prints a schema-valid tree from `mdxserve document --json`",
		async (file) => {
			const outcome = await runDocument(
				path.join(exampleDir, file),
				{ json: true },
				{ registry, cwd: exampleDir, home: exampleDir },
			);
			expect(outcome.exitCode).toBe(0);
			const tree = JSON.parse(outcome.stdout.join("\n"));
			expect(documentTreeSchema.parse(tree)).toEqual(tree);
		},
	);
});
