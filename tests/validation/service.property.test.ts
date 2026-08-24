import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { ValidationService } from "../../src/validation/service.js";
import type { RenderOutcome } from "../../src/rendering/protocol.js";
import { fixtureRegistry as registry } from "../fixtures/registry.js";

const PROPERTY_TIMEOUT_MS = 30000;

const validDocArb = fc.constant("# Doc\n\nSome plain prose about widgets.\n");
const invalidDocArb = fc.constant("# Doc\n\n<UnknownComponent />\n");
const docArb = fc.oneof(validDocArb, invalidDocArb);

const renderOutcomeArb: fc.Arbitrary<RenderOutcome> = fc.oneof(
	fc.constant<RenderOutcome>({ ok: true }),
	fc.string({ minLength: 1, maxLength: 20 }).map((message) => ({ ok: false as const, message })),
);

async function mkTmpDoc(content: string): Promise<{ root: string; abs: string }> {
	const root = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-validation-service-prop-")),
	);
	const abs = path.join(root, "doc.md");
	await fs.writeFile(abs, content, "utf8");
	return { root, abs };
}

describe("ValidationService — allowRender: false", () => {
	it(
		"rendered is always false and the render port is never called",
		async () => {
			await fc.assert(
				fc.asyncProperty(docArb, async (content) => {
					const { root, abs } = await mkTmpDoc(content);
					try {
						const render = vi.fn(async (): Promise<RenderOutcome> => ({ ok: true }));
						const service = new ValidationService([{ name: "docs", dir: root }], registry, render);
						const result = await service.validateDoc({ path: abs, allowRender: false });
						expect(result.kind).toBe("ok");
						if (result.kind !== "ok") return;
						expect(result.result.rendered).toBe(false);
						expect(render).not.toHaveBeenCalled();
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

describe("ValidationService — allowRender: true", () => {
	it(
		"rendered is true iff there is no static error diagnostic, and render-error diagnostics only appear when rendered",
		async () => {
			await fc.assert(
				fc.asyncProperty(docArb, renderOutcomeArb, async (content, outcome) => {
					const { root, abs } = await mkTmpDoc(content);
					try {
						const render = vi.fn(async (): Promise<RenderOutcome> => outcome);
						const service = new ValidationService([{ name: "docs", dir: root }], registry, render);
						const result = await service.validateDoc({ path: abs, allowRender: true });
						expect(result.kind).toBe("ok");
						if (result.kind !== "ok") return;

						const hasStaticError = content.includes("UnknownComponent");
						expect(result.result.rendered).toBe(!hasStaticError);
						expect(render).toHaveBeenCalledTimes(hasStaticError ? 0 : 1);

						const renderErrorDiagnostics = result.result.diagnostics.filter(
							(diagnostic) => diagnostic.code === "render-error",
						);
						if (renderErrorDiagnostics.length > 0) expect(result.result.rendered).toBe(true);
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

describe("ValidationService — validateDoc agrees with validateText", () => {
	it(
		"validateDoc({path}) deep-equals validateText({source: readFile(path), absPath: realpath}) for the same file and allowRender",
		async () => {
			await fc.assert(
				fc.asyncProperty(docArb, fc.boolean(), async (content, allowRender) => {
					const { root, abs } = await mkTmpDoc(content);
					try {
						const render = vi.fn(async (): Promise<RenderOutcome> => ({ ok: true }));
						const service = new ValidationService([{ name: "docs", dir: root }], registry, render);

						const viaDoc = await service.validateDoc({ path: abs, allowRender });
						expect(viaDoc.kind).toBe("ok");
						if (viaDoc.kind !== "ok") return;

						const realAbs = await fs.realpath(abs);
						const source = await fs.readFile(abs, "utf8");
						const viaText = await service.validateText({ source, absPath: realAbs, allowRender });

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
});
