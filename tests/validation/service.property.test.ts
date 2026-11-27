import { createMetadataPort } from "../helpers/metadata.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { ValidationService } from "../../src/validation/service.js";
import { fixtureRegistry as registry } from "../fixtures/registry.js";

const PROPERTY_TIMEOUT_MS = 30000;

const validDocArb = fc.constant("# Doc\n\nSome plain prose about widgets.\n");
const invalidDocArb = fc.constant("# Doc\n\n<UnknownComponent />\n");
const docArb = fc.oneof(validDocArb, invalidDocArb);

async function mkTmpDoc(content: string): Promise<{ root: string; abs: string }> {
	const root = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-validation-service-prop-")),
	);
	const abs = path.join(root, "doc.md");
	await fs.writeFile(abs, content, "utf8");
	return { root, abs };
}

describe("ValidationService — validateDoc agrees with validateText", () => {
	it(
		"validateDoc({path}) deep-equals validateText({source: readFile(path), absPath: realpath}) for the same file",
		async () => {
			await fc.assert(
				fc.asyncProperty(docArb, async (content) => {
					const { root, abs } = await mkTmpDoc(content);
					try {
						const service = new ValidationService(
							[{ name: "docs", dir: root }],
							registry,
							createMetadataPort(),
						);

						const viaDoc = await service.validateDoc({ path: abs });
						expect(viaDoc.kind).toBe("ok");
						if (viaDoc.kind !== "ok") return;

						const realAbs = await fs.realpath(abs);
						const source = await fs.readFile(abs, "utf8");
						const viaText = await service.validateText({ source, absPath: realAbs });

						expect(viaDoc.result).toEqual(viaText);
					} finally {
						await fs.rm(root, { recursive: true, force: true });
					}
				}),
				{ numRuns: 15 },
			);
		},
		PROPERTY_TIMEOUT_MS,
	);

	it(
		"flags an error exactly when the doc names an unknown component",
		async () => {
			await fc.assert(
				fc.asyncProperty(docArb, async (content) => {
					const { root, abs } = await mkTmpDoc(content);
					try {
						const service = new ValidationService(
							[{ name: "docs", dir: root }],
							registry,
							createMetadataPort(),
						);
						const result = await service.validateDoc({ path: abs });
						if (result.kind !== "ok") throw new Error(result.kind);
						expect(result.result.ok).toBe(!content.includes("UnknownComponent"));
					} finally {
						await fs.rm(root, { recursive: true, force: true });
					}
				}),
				{ numRuns: 15 },
			);
		},
		PROPERTY_TIMEOUT_MS,
	);
});
