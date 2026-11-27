import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { spliceLines } from "../../src/docs/edit.js";
import { versionOf } from "../../src/docs/service.js";
import { createCallerFactory } from "../../src/api/trpc.js";
import { appRouter } from "../../src/api/router.js";
import { fixtureRegistry as registry } from "../fixtures/registry.js";
import { makeContext } from "../helpers/context.js";
import { DocumentService } from "../../src/document/service.js";
import { assetUrl } from "../../src/assets/url.js";
import { documentResultSchema } from "../../src/docs/controller.js";

const createCaller = createCallerFactory(appRouter);
const PROPERTY_TIMEOUT_MS = 30000;

// --- shared generators ----------------------------------------------------

// Plain prose lines only, so every spliced file is valid MDX and the
// validation step never gets in the way of the properties below.
const proseLine = fc
	.array(fc.constantFrom("alpha", "beta", "gamma", "delta"), { minLength: 1, maxLength: 4 })
	.map((words) => words.join(" "));
const proseDoc = fc
	.array(proseLine, { minLength: 1, maxLength: 8 })
	.map((lines) => "# Title\n\n" + lines.join("\n") + "\n");
const replacementArb = fc
	.array(proseLine, { minLength: 1, maxLength: 3 })
	.map((lines) => lines.join("\n"));

// --- getDocument ----------------------------------------------------------

const docBlock = fc.oneof(
	fc.constantFrom("# Title", "## Install", "## Install", "### Examples"),
	proseLine,
	fc.constantFrom(
		'<Callout tone="tip">\n  Note\n</Callout>',
		'<Tabs id="pick">\n  <Tab label="One">\n    one\n  </Tab>\n</Tabs>',
		'<Tabs>\n  <Tab label="One">\n    one\n  </Tab>\n</Tabs>',
		"Broken {1 +} here",
		"```mermaid\ngraph TD; A-->B\n```",
		"![pic](./pic.png)",
	),
);
const anyDoc = fc.oneof(
	fc.array(docBlock, { maxLength: 8 }).map((blocks) => blocks.join("\n\n") + "\n"),
	fc.string(),
);

// --- getNodeSource / saveDocNode ------------------------------------------

describe("getNodeSource / saveDocNode properties", () => {
	it(
		"saving back what getNodeSource returned leaves the file byte-identical, for any document and any id",
		async () => {
			await fc.assert(
				fc.asyncProperty(anyDoc, async (doc) => {
					const root = await fs.realpath(
						await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-node-identity-prop-")),
					);
					try {
						const abs = path.join(root, "doc.mdx");
						await fs.writeFile(abs, doc, "utf8");
						const caller = createCaller(makeContext(root, registry));
						const { ranges } = new DocumentService(registry, assetUrl).parse(doc, abs);
						for (const id of ranges.keys()) {
							const node = await caller.getNodeSource({ path: abs, id });
							expect(node.version).toBe(versionOf(doc));
							const saved = await caller.saveDocNode({
								path: abs,
								id,
								version: node.version,
								markdown: node.markdown,
							});
							expect(saved.version).toBe(versionOf(doc));
							expect(await fs.readFile(abs, "utf8")).toBe(doc);
						}
					} finally {
						await fs.rm(root, { recursive: true, force: true });
					}
				}),
				{ numRuns: 40 },
			);
		},
		PROPERTY_TIMEOUT_MS,
	);

	it(
		"save then read equals the spliceLines oracle over the node's lines, and the returned version is the new file's",
		async () => {
			await fc.assert(
				fc.asyncProperty(
					proseDoc.chain((doc) => fc.tuple(fc.constant(doc), replacementArb)),
					async ([doc, replacement]) => {
						const root = await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-save-prop-"));
						try {
							const abs = path.join(root, "doc.md");
							await fs.writeFile(abs, doc, "utf8");
							const caller = createCaller(makeContext(root, registry));
							const before = await caller.getNodeSource({ path: abs, id: "title" });
							const saved = await caller.saveDocNode({
								path: abs,
								id: "title",
								version: before.version,
								markdown: replacement,
							});
							// The whole doc is the one "title" section, with no trailing blank line.
							const oracle = spliceLines(doc, 1, doc.split("\n").length - 1, replacement);
							expect(oracle.ok).toBe(true);
							const after = await fs.readFile(abs, "utf8");
							expect(after).toBe(oracle.ok ? oracle.text : "");
							expect(saved.version).toBe(versionOf(after));
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

	it(
		"a stale version never changes the file (invariance under rejected saves)",
		async () => {
			await fc.assert(
				fc.asyncProperty(
					proseDoc.chain((doc) => fc.tuple(fc.constant(doc), replacementArb)),
					async ([doc, replacement]) => {
						const root = await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-stale-prop-"));
						try {
							const abs = path.join(root, "doc.md");
							await fs.writeFile(abs, doc, "utf8");
							const caller = createCaller(makeContext(root, registry));
							const before = await fs.readFile(abs, "utf8");
							await expect(
								caller.saveDocNode({
									path: abs,
									id: "title",
									version: versionOf(`${doc}-drifted`),
									markdown: replacement,
								}),
							).rejects.toMatchObject({ code: "CONFLICT" });
							expect(await fs.readFile(abs, "utf8")).toBe(before);
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

describe("getDocument properties", () => {
	it(
		"returns what DocumentService.parse builds for the bytes on disk, with their version, for any file",
		async () => {
			await fc.assert(
				fc.asyncProperty(anyDoc, async (doc) => {
					const root = await fs.realpath(
						await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-get-document-prop-")),
					);
					try {
						const abs = path.join(root, "doc.mdx");
						await fs.writeFile(abs, doc, "utf8");
						const result = await createCaller(makeContext(root, registry)).getDocument({
							path: abs,
						});
						const expected = new DocumentService(registry, assetUrl).parse(doc, abs).tree;
						expect(result).toEqual({ document: expected, version: versionOf(doc) });
						expect(documentResultSchema.parse(result)).toEqual(result);
					} finally {
						await fs.rm(root, { recursive: true, force: true });
					}
				}),
				{ numRuns: 40 },
			);
		},
		PROPERTY_TIMEOUT_MS,
	);
});
