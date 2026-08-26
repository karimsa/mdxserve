import { describe, expect, it } from "vitest";
import { decodeContents, exportFileName, mimeFor } from "../../client/export-save.js";

describe("exportFileName", () => {
	it("strips the source doc extension and appends the target one", () => {
		expect(exportFileName("/a/b/guide.md", "html")).toBe("guide.html");
		expect(exportFileName("C:\\docs\\guide.MDX", "html")).toBe("guide.html");
		expect(exportFileName("a.b.md", "html")).toBe("a.b.html");
		expect(exportFileName("README", "html")).toBe("README.html");
		expect(exportFileName("notes.mdx", "pdf")).toBe("notes.pdf");
	});
});

describe("mimeFor", () => {
	it("maps html to text/html and anything else to a generic binary type", () => {
		expect(mimeFor("html")).toBe("text/html");
		expect(mimeFor("pdf")).toBe("application/octet-stream");
		expect(mimeFor("")).toBe("application/octet-stream");
	});
});

describe("decodeContents", () => {
	it("round-trips utf8 text", async () => {
		const text = "hello \u00e9\u00e8 world \u{1f600}";
		const blob = decodeContents(text, "utf8");
		expect(await blob.text()).toBe(text);
	});

	it("round-trips base64 bytes", async () => {
		const bytes = Buffer.from([0, 1, 2, 254, 255, 16, 32]);
		const base64 = bytes.toString("base64");
		const blob = decodeContents(base64, "base64");
		const roundTripped = Buffer.from(await blob.arrayBuffer());
		expect(roundTripped.equals(bytes)).toBe(true);
	});
});
