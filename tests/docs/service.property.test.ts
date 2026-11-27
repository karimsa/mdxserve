import { createMetadataPort } from "../helpers/metadata.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { spliceLines } from "../../src/docs/edit.js";
import { DocsService, versionOf } from "../../src/docs/service.js";
import { DocumentService } from "../../src/document/service.js";
import { RootsService } from "../../src/roots/service.js";
import { fixtureRegistry as registry } from "../fixtures/registry.js";

const PROPERTY_TIMEOUT_MS = 30000;

const wordArb = fc.constantFrom("alpha", "beta", "gamma", "delta", "widget", "gadget");
const proseLineArb = fc
	.array(wordArb, { minLength: 1, maxLength: 5 })
	.map((words) => words.join(" "));
const eolArb = fc.constantFrom<"\n" | "\r\n">("\n", "\r\n");

interface GeneratedDoc {
	text: string;
	lines: string[];
	eol: "\n" | "\r\n";
	/** The ID of each `##` section and the lines of its heading and prose, as written. */
	sections: { id: string; startLine: number; endLine: number }[];
}

/**
 * A doc with an h1, some preamble prose, and `##` sections of prose, with a
 * chosen EOL style and trailing-newline state. The sections' line numbers are
 * known by construction, so tests do not depend on the parser to find them.
 */
const docArb: fc.Arbitrary<GeneratedDoc> = fc
	.tuple(
		fc.array(proseLineArb, { minLength: 1, maxLength: 2 }),
		fc.array(fc.array(proseLineArb, { minLength: 1, maxLength: 3 }), {
			minLength: 1,
			maxLength: 4,
		}),
		eolArb,
		fc.boolean(),
	)
	.map(([preamble, sectionBodies, eol, trailingEol]) => {
		const lines = ["# Title", "", ...preamble];
		const sections: GeneratedDoc["sections"] = [];
		sectionBodies.forEach((body, index) => {
			lines.push("", `## Section ${wordNumber(index)}`);
			const startLine = lines.length;
			lines.push("", ...body);
			sections.push({ id: `section-${wordNumber(index)}`, startLine, endLine: lines.length });
		});
		return { text: lines.join(eol) + (trailingEol ? eol : ""), lines, eol, sections };
	});

function wordNumber(index: number): string {
	return ["one", "two", "three", "four"][index] ?? String(index);
}

const replacementArb = fc
	.array(proseLineArb, { minLength: 1, maxLength: 3 })
	.map((lines) => lines.join("\n"));

async function mkTmpRoot(prefix: string): Promise<string> {
	return fs.mkdtemp(path.join(os.tmpdir(), `mdxserve-docs-service-prop-${prefix}`));
}

function serviceFor(root: string): DocsService {
	return new DocsService(new RootsService(root, os.homedir(), [root]), registry);
}

describe("DocsService — save-then-read round trip", () => {
	it(
		"readSource after saveNode matches the spliceLines oracle, for either EOL style and trailing-newline state",
		async () => {
			await fc.assert(
				fc.asyncProperty(
					docArb.chain((doc) =>
						fc.tuple(fc.constant(doc), fc.constantFrom(...doc.sections), replacementArb),
					),
					async ([doc, section, replacement]) => {
						const root = await mkTmpRoot("roundtrip-");
						try {
							const abs = path.join(root, "doc.md");
							await fs.writeFile(abs, doc.text, "utf8");
							const service = serviceFor(root);

							const saved = await service.saveNode({
								path: abs,
								id: section.id,
								version: versionOf(doc.text),
								markdown: replacement,
							});
							expect(saved.kind).toBe("ok");

							const oracle = spliceLines(doc.text, section.startLine, section.endLine, replacement);
							expect(oracle.ok).toBe(true);
							if (!oracle.ok) return;

							const read = await service.readSource(abs);
							expect(read.kind).toBe("ok");
							if (read.kind !== "ok") return;
							expect(read.source.text).toBe(oracle.text);
							expect(read.source.version).toBe(versionOf(read.source.text));
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
		"readNodeSource then saveNode with the same markdown leaves the file byte-identical, for every node id",
		async () => {
			await fc.assert(
				fc.asyncProperty(docArb, async (doc) => {
					const root = await mkTmpRoot("identity-");
					try {
						const abs = path.join(root, "doc.md");
						await fs.writeFile(abs, doc.text, "utf8");
						const service = serviceFor(root);
						const { ranges } = new DocumentService(registry, (relative) => relative).parse(
							doc.text,
							abs,
						);
						expect(ranges.size).toBeGreaterThan(0);

						for (const id of ranges.keys()) {
							const read = await service.readNodeSource(abs, id);
							expect(read.kind).toBe("ok");
							if (read.kind !== "ok") return;
							expect(read.version).toBe(versionOf(doc.text));
							const saved = await service.saveNode({
								path: abs,
								id,
								version: read.version,
								markdown: read.markdown,
							});
							expect(saved).toEqual({ kind: "ok", version: versionOf(doc.text) });
							const after = await fs.readFile(abs);
							expect(after.equals(Buffer.from(doc.text, "utf8"))).toBe(true);
						}
					} finally {
						await fs.rm(root, { recursive: true, force: true });
					}
				}),
				{ numRuns: 20 },
			);
		},
		PROPERTY_TIMEOUT_MS,
	);
});

describe("DocsService — rejected saves leave the file untouched", () => {
	it(
		"a stale version, an unknown id, and an introduced error all leave the file byte-identical, with no leftover .*.mdxserve-tmp file",
		async () => {
			await fc.assert(
				fc.asyncProperty(
					docArb,
					fc.constantFrom("stale", "unknown-id", "invalid-doc"),
					async (doc, mode) => {
						const root = await mkTmpRoot("reject-");
						try {
							const abs = path.join(root, "doc.md");
							await fs.writeFile(abs, doc.text, "utf8");
							const service = serviceFor(root);
							const id = doc.sections[0].id;

							const input =
								mode === "stale"
									? {
											path: abs,
											id,
											version: versionOf(`${doc.text}-drifted`),
											markdown: "changed",
										}
									: mode === "unknown-id"
										? {
												path: abs,
												id: "no-such-node",
												version: versionOf(doc.text),
												markdown: "changed",
											}
										: {
												path: abs,
												id,
												version: versionOf(doc.text),
												markdown: "<UnknownComponent />",
											};

							const result = await service.saveNode(input);
							expect(result.kind).toBe(
								mode === "stale" ? "stale" : mode === "unknown-id" ? "not-found" : "invalid-doc",
							);

							const after = await fs.readFile(abs);
							expect(after.equals(Buffer.from(doc.text, "utf8"))).toBe(true);

							const dirEntries = await fs.readdir(root);
							expect(
								dirEntries.some((name) => name.startsWith(".") && name.endsWith(".mdxserve-tmp")),
							).toBe(false);
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
});

describe("DocsService — concurrent saves", () => {
	it(
		"two concurrent saves on one instance with the same original version: exactly one ok, the other stale",
		async () => {
			await fc.assert(
				fc.asyncProperty(
					docArb,
					replacementArb,
					replacementArb,
					async (doc, replacementA, replacementB) => {
						const root = await mkTmpRoot("concurrent-");
						try {
							const abs = path.join(root, "doc.md");
							await fs.writeFile(abs, doc.text, "utf8");
							const service = serviceFor(root);
							const id = doc.sections[0].id;

							const [resultA, resultB] = await Promise.all([
								service.saveNode({
									path: abs,
									id,
									version: versionOf(doc.text),
									markdown: replacementA,
								}),
								service.saveNode({
									path: abs,
									id,
									version: versionOf(doc.text),
									markdown: replacementB,
								}),
							]);

							expect([resultA.kind, resultB.kind].sort()).toEqual(["ok", "stale"]);
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
});

describe("DocsService source metadata", () => {
	it("keeps metadata and YAML boundaries independent of the document body and newline style", () => {
		fc.assert(
			fc.property(proseLineArb, eolArb, fc.string(), (title, eol, body) => {
				const source = ["---", `title: ${title}`, "---", body].join(eol);
				expect(createMetadataPort().parseMetadata(source)).toEqual({
					metadata: { title, openGraph: [] },
					diagnostics: [],
				});
				expect(createMetadataPort().leadingFrontmatter(source)).toEqual({
					value: `title: ${title}`,
					startLine: 2,
					endLine: 3,
				});
			}),
		);
	});
});
