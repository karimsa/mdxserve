import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { decodeContents, exportFileName } from "../../client/export-save.js";

const extension = fc.constantFrom("html", "pdf", "txt");
const docPath = fc
	.tuple(
		fc.array(fc.stringMatching(/^[A-Za-z0-9_-]+$/), { maxLength: 4 }),
		fc.stringMatching(/^[A-Za-z0-9_-]+$/),
		fc.constantFrom(".md", ".mdx", ".MD", ".MDX", ""),
		fc.constantFrom("/", "\\"),
	)
	.map(([dirs, base, sourceExtension, separator]) =>
		[...dirs, `${base}${sourceExtension}`].join(separator),
	);

describe("exportFileName", () => {
	it("never contains a path separator and always ends in the target extension", () => {
		fc.assert(
			fc.property(docPath, extension, (path, targetExtension) => {
				const result = exportFileName(path, targetExtension);
				expect(result).not.toMatch(/[/\\]/);
				expect(result.endsWith(`.${targetExtension}`)).toBe(true);
			}),
		);
	});

	it("is idempotent modulo the extension", () => {
		fc.assert(
			fc.property(docPath, extension, (path, targetExtension) => {
				const once = exportFileName(path, targetExtension);
				const twice = exportFileName(once, targetExtension);
				expect(twice).toBe(once);
			}),
		);
	});

	it("equals the last segment's stem plus the target extension", () => {
		fc.assert(
			fc.property(docPath, extension, (path, targetExtension) => {
				const lastSegment = path.split(/[/\\]/).pop() ?? path;
				const stem = lastSegment
					.replace(/\.mdx?$/i, "")
					.replace(new RegExp(`\\.${targetExtension}$`, "i"), "");
				expect(exportFileName(path, targetExtension)).toBe(`${stem}.${targetExtension}`);
			}),
		);
	});
});

describe("decodeContents", () => {
	it("round-trips arbitrary unicode text through utf8", async () => {
		await fc.assert(
			fc.asyncProperty(fc.string(), async (text) => {
				const blob = decodeContents(text, "utf8");
				expect(await blob.text()).toBe(text);
			}),
		);
	});

	it("round-trips arbitrary bytes through base64", async () => {
		await fc.assert(
			fc.asyncProperty(fc.uint8Array({ maxLength: 256 }), async (bytes) => {
				const buffer = Buffer.from(bytes);
				const blob = decodeContents(buffer.toString("base64"), "base64");
				const roundTripped = Buffer.from(await blob.arrayBuffer());
				expect(roundTripped.equals(buffer)).toBe(true);
			}),
		);
	});
});
