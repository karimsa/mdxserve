import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { BundleInput } from "../../src/rendering/protocol.js";
import { ExportService, type ExportFormat } from "../../src/export/service.js";

function fakeBundle(): {
	port: (input: BundleInput) => Promise<{ js: string; css: string; warnings: string[] }>;
	calls: BundleInput[];
} {
	const calls: BundleInput[] = [];
	return {
		calls,
		port: async (input) => {
			calls.push(input);
			return { js: "console.log(1)", css: "body{}", warnings: ["w1"] };
		},
	};
}

function rejectingBundle(message: string): { port: () => Promise<never>; calls: BundleInput[] } {
	return {
		calls: [],
		port: async () => {
			throw new Error(message);
		},
	};
}

let rootA: string;
let rootB: string;

beforeAll(async () => {
	rootA = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-export-svc-a-")));
	rootB = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-export-svc-b-")));

	await fs.writeFile(
		path.join(rootA, "fenced.md"),
		"# Fenced\n\n```mermaid\ngraph TD\nA-->B\n```\n",
		"utf8",
	);
	await fs.writeFile(path.join(rootA, "plain.md"), "# Plain\n\nNo diagrams here.\n", "utf8");
	await fs.writeFile(
		path.join(rootA, "pie.md"),
		'# Pie\n\n```mermaid\npie title Pets\n  "Dogs" : 40\n```\n',
		"utf8",
	);
	await fs.writeFile(
		path.join(rootA, "pie-and-flow.md"),
		'# Mixed\n\n```mermaid\npie title Pets\n  "Dogs" : 40\n```\n\n```mermaid\nflowchart TD\n  A --> B\n```\n',
		"utf8",
	);
	await fs.writeFile(path.join(rootA, "notes.txt"), "not a doc\n", "utf8");
	await fs.writeFile(path.join(rootB, "other.md"), "# Other root\n", "utf8");
	// A symlink inside rootA that escapes to rootB.
	await fs.symlink(rootB, path.join(rootA, "escape"), "dir");
});

const cleanupFiles: string[] = [];

afterEach(async () => {
	for (const file of cleanupFiles.splice(0)) {
		await fs.rm(file, { force: true });
	}
});

describe("ExportService.build", () => {
	it("builds an ok result from the fake bundle port", async () => {
		const { port, calls } = fakeBundle();
		const service = new ExportService(port, [rootA]);
		const result = await service.build({ docPath: path.join(rootA, "plain.md"), format: "html" });
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		expect(result.contents).toContain("console.log(1)");
		expect(result.contents).toContain("body{}");
		expect(result.fileName).toBe("plain.html");
		expect(result.bytes).toBe(Buffer.byteLength(result.contents));
		expect(result.warnings).toEqual(["w1"]);
		expect(result.encoding).toBe("utf8");
		expect(calls).toHaveLength(1);
	});

	it("build leaves the directory listing byte-identical", async () => {
		const before = (await fs.readdir(rootA)).sort();
		const beforeBytes = await fs.readFile(path.join(rootA, "plain.md"));
		const { port } = fakeBundle();
		const service = new ExportService(port, [rootA]);
		await service.build({ docPath: path.join(rootA, "plain.md"), format: "html" });
		const after = (await fs.readdir(rootA)).sort();
		expect(after).toEqual(before);
		const afterBytes = await fs.readFile(path.join(rootA, "plain.md"));
		expect(afterBytes.equals(beforeBytes)).toBe(true);
	});

	it("export writes outFile with bytes equal to build().contents", async () => {
		const { port } = fakeBundle();
		const buildService = new ExportService(port, [rootA]);
		const built = await buildService.build({
			docPath: path.join(rootA, "plain.md"),
			format: "html",
		});
		expect(built.kind).toBe("ok");
		if (built.kind !== "ok") return;

		const outFile = path.join(rootA, "out.html");
		cleanupFiles.push(outFile);
		const { port: exportPort } = fakeBundle();
		const exportService = new ExportService(exportPort, [rootA]);
		const exported = await exportService.export({
			docPath: path.join(rootA, "plain.md"),
			outFile,
			format: "html",
		});
		expect(exported.kind).toBe("ok");
		if (exported.kind !== "ok") return;
		const written = await fs.readFile(outFile, "utf8");
		expect(written).toBe(built.contents);
	});

	it("returns not-found for a missing file", async () => {
		const { port } = fakeBundle();
		const service = new ExportService(port, [rootA]);
		const result = await service.build({ docPath: path.join(rootA, "missing.md"), format: "html" });
		expect(result.kind).toBe("not-found");
	});

	it("returns not-a-doc for a non-markdown extension", async () => {
		const { port } = fakeBundle();
		const service = new ExportService(port, [rootA]);
		const result = await service.build({ docPath: path.join(rootA, "notes.txt"), format: "html" });
		expect(result.kind).toBe("not-a-doc");
	});

	it("returns unsupported-format for an unknown format", async () => {
		const { port } = fakeBundle();
		const service = new ExportService(port, [rootA]);
		const result = await service.build({
			docPath: path.join(rootA, "plain.md"),
			format: "pdf" as ExportFormat,
		});
		expect(result.kind).toBe("unsupported-format");
	});

	it("returns bundle-failed with the port's error message when the port rejects", async () => {
		const { port } = rejectingBundle("boom");
		const service = new ExportService(port, [rootA]);
		const result = await service.build({ docPath: path.join(rootA, "plain.md"), format: "html" });
		expect(result.kind).toBe("bundle-failed");
		if (result.kind !== "bundle-failed") return;
		expect(result.message).toBe("boom");
	});

	it("a doc in a different root than rootDirs is not-found and never calls the bundle port", async () => {
		const { port, calls } = fakeBundle();
		const service = new ExportService(port, [rootA]);
		const result = await service.build({ docPath: path.join(rootB, "other.md"), format: "html" });
		expect(result.kind).toBe("not-found");
		expect(calls).toHaveLength(0);
	});

	it("an escaping symlink is not-found", async () => {
		const { port } = fakeBundle();
		const service = new ExportService(port, [rootA]);
		const result = await service.build({
			docPath: path.join(rootA, "escape", "other.md"),
			format: "html",
		});
		expect(result.kind).toBe("not-found");
	});

	it("no rootDirs at all accepts an absolute path (CLI parity)", async () => {
		const { port } = fakeBundle();
		const service = new ExportService(port);
		const result = await service.build({ docPath: path.join(rootA, "plain.md"), format: "html" });
		expect(result.kind).toBe("ok");
	});

	it("an empty rootDirs list (no folders served) resolves nothing and never calls the bundle port", async () => {
		const { port, calls } = fakeBundle();
		const service = new ExportService(port, []);
		const result = await service.build({ docPath: path.join(rootA, "plain.md"), format: "html" });
		expect(result.kind).toBe("not-found");
		expect(calls).toHaveLength(0);
	});

	it("forces mermaid to none for a doc with no fence, even when bundle is requested", async () => {
		const { port, calls } = fakeBundle();
		const service = new ExportService(port, [rootA]);
		const result = await service.build({
			docPath: path.join(rootA, "plain.md"),
			format: "html",
			mermaid: "bundle",
		});
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		expect(result.mermaid).toBe("none");
		expect(calls[0]?.mermaid).toBe("none");
	});

	it("forces mermaid to none for a pie-only doc, even when bundle is requested", async () => {
		const { port, calls } = fakeBundle();
		const service = new ExportService(port, [rootA]);
		const result = await service.build({
			docPath: path.join(rootA, "pie.md"),
			format: "html",
			mermaid: "bundle",
		});
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		expect(result.mermaid).toBe("none");
		expect(calls[0]?.mermaid).toBe("none");
	});

	it("still bundles mermaid for a doc mixing a chart fence with a real diagram", async () => {
		const { port, calls } = fakeBundle();
		const service = new ExportService(port, [rootA]);
		const result = await service.build({
			docPath: path.join(rootA, "pie-and-flow.md"),
			format: "html",
			mermaid: "bundle",
		});
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		expect(result.mermaid).toBe("bundle");
		expect(calls[0]?.mermaid).toBe("bundle");
	});

	it("passes the requested mermaid mode through for a doc with a fence, defaulting to cdn", async () => {
		const { port, calls } = fakeBundle();
		const service = new ExportService(port, [rootA]);
		const result = await service.build({ docPath: path.join(rootA, "fenced.md"), format: "html" });
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		expect(result.mermaid).toBe("cdn");
		expect(calls[0]?.mermaid).toBe("cdn");

		const { port: portBundle, calls: callsBundle } = fakeBundle();
		const serviceBundle = new ExportService(portBundle, [rootA]);
		const resultBundle = await serviceBundle.build({
			docPath: path.join(rootA, "fenced.md"),
			format: "html",
			mermaid: "bundle",
		});
		expect(resultBundle.kind).toBe("ok");
		if (resultBundle.kind !== "ok") return;
		expect(resultBundle.mermaid).toBe("bundle");
		expect(callsBundle[0]?.mermaid).toBe("bundle");
	});
});
