import { build } from "esbuild";
import { beforeAll, it, expect } from "vitest";
import sharp from "sharp";
import { normalizeDiagramImage } from "../../src/diagrams/adapters/image.js";
import { validateDiagram } from "../../src/diagrams/adapters/validate.js";
import { diagramPolicyError } from "../../src/diagrams/policy.js";
beforeAll(async () => {
	await build({
		entryPoints: ["src/diagrams/adapters/validate-worker.ts"],
		outfile: "dist/diagram-worker.js",
		bundle: true,
		platform: "node",
		target: "node22",
		format: "esm",
		packages: "external",
	});
});
it("decodes image bytes rather than trusting MIME", async () => {
	await expect(normalizeDiagramImage(Buffer.from("<svg/>"))).rejects.toThrow();
	const bytes = await sharp({ create: { width: 40, height: 30, channels: 3, background: "white" } })
		.jpeg()
		.toBuffer();
	const image = await normalizeDiagramImage(bytes);
	expect((await sharp(image).metadata()).format).toBe("png");
});
it("validates ER and flowchart syntax and rejects invalid syntax", async () => {
	const signal = new AbortController().signal;
	expect(await validateDiagram("erDiagram\n CUSTOMER ||--o{ ORDER : places", signal)).toBe(null);
	expect(await validateDiagram("flowchart TD\n Start --> End", signal)).toBe(null);
	expect(await validateDiagram("flowchart TD\n Alpha --> [", signal)).not.toBe(null);
}, 15000);
it("blocks active content without rejecting flowchart arrows", () => {
	expect(diagramPolicyError("flowchart TD\n Alpha --> Beta")).toBe(null);
	expect(diagramPolicyError('flowchart TD\n click Alpha "https://example.com"')).not.toBe(null);
});
