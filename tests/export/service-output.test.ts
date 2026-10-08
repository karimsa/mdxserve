import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { ExportService, MERMAID_MODES, type ExportFormat } from "../../src/export/service.js";
import type { BundleInput, MermaidMode } from "../../src/rendering/protocol.js";

const PROPERTY_TIMEOUT_MS = 30000;

function fakeBundle(): {
	port: (input: BundleInput) => Promise<{ js: string; css: string; warnings: string[] }>;
	calls: BundleInput[];
} {
	const calls: BundleInput[] = [];
	return {
		calls,
		port: async (input) => {
			calls.push(input);
			return { js: "console.log(1)", css: "body{}", warnings: [] };
		},
	};
}

const baseNameArb = fc
	.stringMatching(/^[a-z][a-z0-9-]{0,12}$/)
	.map((value) => (value.length > 0 ? value : "doc"));
const extensionArb = fc.constantFrom(".md", ".mdx", ".MD");
const requestedModeArb = fc.option(fc.constantFrom(...MERMAID_MODES), { nil: undefined });

async function mkTmpRoot(prefix: string): Promise<string> {
	return fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), `mdxserve-export-svc-prop-${prefix}`)),
	);
}

describe("ExportService.build — properties", () => {
	it(
		"result.mermaid follows the fence/requested-mode rule and the port receives the same mode",
		async () => {
			await fc.assert(
				fc.asyncProperty(
					fc.record({
						hasFence: fc.boolean(),
						requestedMode: requestedModeArb,
						baseName: baseNameArb,
						extension: extensionArb,
					}),
					async ({ hasFence, requestedMode, baseName, extension }) => {
						const root = await mkTmpRoot("invariance-");
						try {
							const docPath = path.join(root, `${baseName}${extension}`);
							const source = hasFence
								? "# Doc\n\n```mermaid\ngraph TD\nA-->B\n```\n"
								: "# Doc\n\nplain content\n";
							await fs.writeFile(docPath, source, "utf8");

							const { port, calls } = fakeBundle();
							const service = new ExportService(port, [root]);
							const result = await service.build({
								docPath,
								format: "html",
								mermaid: requestedMode,
							});

							expect(result.kind).toBe("ok");
							if (result.kind !== "ok") return;
							const expected: MermaidMode = hasFence ? (requestedMode ?? "cdn") : "none";
							expect(result.mermaid).toBe(expected);
							expect(calls[0]?.mermaid).toBe(expected);
						} finally {
							await fs.rm(root, { recursive: true, force: true });
						}
					},
				),
				{ numRuns: 20 },
			);
		},
		PROPERTY_TIMEOUT_MS,
	);

	it(
		"build never changes the fixture directory's file list or any file's bytes",
		async () => {
			await fc.assert(
				fc.asyncProperty(
					fc.record({
						hasFence: fc.boolean(),
						requestedMode: requestedModeArb,
						baseName: baseNameArb,
						extension: extensionArb,
					}),
					async ({ hasFence, requestedMode, baseName, extension }) => {
						const root = await mkTmpRoot("no-mutate-");
						try {
							const docPath = path.join(root, `${baseName}${extension}`);
							const source = hasFence
								? "# Doc\n\n```mermaid\ngraph TD\nA-->B\n```\n"
								: "# Doc\n\nplain content\n";
							await fs.writeFile(docPath, source, "utf8");

							const before = (await fs.readdir(root)).sort();
							const beforeBytes = await fs.readFile(docPath);

							const { port } = fakeBundle();
							const service = new ExportService(port, [root]);
							await service.build({ docPath, format: "html", mermaid: requestedMode });

							const after = (await fs.readdir(root)).sort();
							expect(after).toEqual(before);
							const afterBytes = await fs.readFile(docPath);
							expect(afterBytes.equals(beforeBytes)).toBe(true);
						} finally {
							await fs.rm(root, { recursive: true, force: true });
						}
					},
				),
				{ numRuns: 20 },
			);
		},
		PROPERTY_TIMEOUT_MS,
	);

	it(
		"fileName never contains a path separator, always ends in .html, and its stem matches the source basename",
		async () => {
			await fc.assert(
				fc.asyncProperty(
					fc.record({
						hasFence: fc.boolean(),
						requestedMode: requestedModeArb,
						baseName: baseNameArb,
						extension: extensionArb,
					}),
					async ({ hasFence, requestedMode, baseName, extension }) => {
						const root = await mkTmpRoot("filename-");
						try {
							const docPath = path.join(root, `${baseName}${extension}`);
							const source = hasFence
								? "# Doc\n\n```mermaid\ngraph TD\nA-->B\n```\n"
								: "# Doc\n\nplain content\n";
							await fs.writeFile(docPath, source, "utf8");

							const { port } = fakeBundle();
							const service = new ExportService(port, [root]);
							const result = await service.build({
								docPath,
								format: "html",
								mermaid: requestedMode,
							});

							expect(result.kind).toBe("ok");
							if (result.kind !== "ok") return;
							expect(result.fileName).not.toContain("/");
							expect(result.fileName).not.toContain("\\");
							expect(result.fileName.endsWith(".html")).toBe(true);
							const stem = result.fileName.slice(0, -".html".length);
							expect(stem).toBe(baseName);
						} finally {
							await fs.rm(root, { recursive: true, force: true });
						}
					},
				),
				{ numRuns: 20 },
			);
		},
		PROPERTY_TIMEOUT_MS,
	);

	it(
		"export() then reading outFile equals build().contents exactly, and bytes equals the on-disk size",
		async () => {
			await fc.assert(
				fc.asyncProperty(
					fc.record({
						hasFence: fc.boolean(),
						requestedMode: requestedModeArb,
						baseName: baseNameArb,
						extension: extensionArb,
					}),
					async ({ hasFence, requestedMode, baseName, extension }) => {
						const root = await mkTmpRoot("roundtrip-");
						try {
							const docPath = path.join(root, `${baseName}${extension}`);
							const source = hasFence
								? "# Doc\n\n```mermaid\ngraph TD\nA-->B\n```\n"
								: "# Doc\n\nplain content\n";
							await fs.writeFile(docPath, source, "utf8");

							const { port: buildPort } = fakeBundle();
							const buildService = new ExportService(buildPort, [root]);
							const built = await buildService.build({
								docPath,
								format: "html",
								mermaid: requestedMode,
							});
							expect(built.kind).toBe("ok");
							if (built.kind !== "ok") return;

							const outFile = path.join(root, "out.html");
							const { port: exportPort } = fakeBundle();
							const exportService = new ExportService(exportPort, [root]);
							const exported = await exportService.export({
								docPath,
								outFile,
								format: "html" as ExportFormat,
								mermaid: requestedMode,
							});
							expect(exported.kind).toBe("ok");
							if (exported.kind !== "ok") return;

							const onDisk = await fs.readFile(outFile, "utf8");
							expect(onDisk).toBe(built.contents);
							const stat = await fs.stat(outFile);
							expect(exported.bytes).toBe(stat.size);
						} finally {
							await fs.rm(root, { recursive: true, force: true });
						}
					},
				),
				{ numRuns: 15 },
			);
		},
		PROPERTY_TIMEOUT_MS,
	);

	it(
		"a path escaping rootDirs (via .. or an absolute path under a different tmp dir) is not-found and never invokes the port",
		async () => {
			await fc.assert(
				fc.asyncProperty(
					fc.record({ baseName: baseNameArb, extension: extensionArb, useDotDot: fc.boolean() }),
					async ({ baseName, extension, useDotDot }) => {
						const root = await mkTmpRoot("contain-root-");
						const outside = await mkTmpRoot("contain-outside-");
						try {
							const outsideDoc = path.join(outside, `${baseName}${extension}`);
							await fs.writeFile(outsideDoc, "# Doc\n\nplain\n", "utf8");

							const docPath = useDotDot
								? path.join(root, "..", path.basename(outside), `${baseName}${extension}`)
								: outsideDoc;

							const { port, calls } = fakeBundle();
							const service = new ExportService(port, [root]);
							const result = await service.build({ docPath, format: "html" });

							expect(result.kind).toBe("not-found");
							expect(calls).toHaveLength(0);
						} finally {
							await fs.rm(root, { recursive: true, force: true });
							await fs.rm(outside, { recursive: true, force: true });
						}
					},
				),
				{ numRuns: 20 },
			);
		},
		PROPERTY_TIMEOUT_MS,
	);

	it(
		"build never throws, and its kind is always one of the five declared members",
		async () => {
			const declaredKinds = new Set([
				"ok",
				"not-found",
				"not-a-doc",
				"unsupported-format",
				"bundle-failed",
			]);
			await fc.assert(
				fc.asyncProperty(
					fc.record({
						hasFence: fc.boolean(),
						requestedMode: requestedModeArb,
						baseName: baseNameArb,
						extension: fc.constantFrom(".md", ".mdx", ".MD", ".txt"),
						format: fc.constantFrom<ExportFormat | "pdf">("html", "pdf"),
						missing: fc.boolean(),
					}),
					async ({ hasFence, requestedMode, baseName, extension, format, missing }) => {
						const root = await mkTmpRoot("no-throw-");
						try {
							const docPath = path.join(root, `${baseName}${extension}`);
							if (!missing) {
								const source = hasFence
									? "# Doc\n\n```mermaid\ngraph TD\nA-->B\n```\n"
									: "# Doc\n\nplain content\n";
								await fs.writeFile(docPath, source, "utf8");
							}

							const { port } = fakeBundle();
							const service = new ExportService(port, [root]);
							let result;
							try {
								result = await service.build({
									docPath,
									format: format as ExportFormat,
									mermaid: requestedMode,
								});
							} catch (error) {
								throw new Error(`build() threw: ${String(error)}`, { cause: error });
							}
							expect(declaredKinds.has(result.kind)).toBe(true);
						} finally {
							await fs.rm(root, { recursive: true, force: true });
						}
					},
				),
				{ numRuns: 25 },
			);
		},
		PROPERTY_TIMEOUT_MS,
	);
});
