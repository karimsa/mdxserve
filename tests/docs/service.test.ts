import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DocsService, versionOf, MAX_SOURCE_BYTES } from "../../src/docs/service.js";
import { RootsService } from "../../src/roots/service.js";
import { fixtureRegistry as registry } from "../fixtures/registry.js";

const ORIGINAL = "# Title\n\nline three\n\nline five\n";

let root: string;
let outside: string;
let abs: string;
let service: DocsService;

beforeEach(async () => {
	root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-docs-service-")));
	outside = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-docs-service-outside-")),
	);
	abs = path.join(root, "doc.md");
	await fs.writeFile(abs, ORIGINAL, "utf8");
	service = new DocsService(new RootsService(root, os.homedir(), [root]), registry);
});

afterEach(async () => {
	await fs.rm(root, { recursive: true, force: true });
	await fs.rm(outside, { recursive: true, force: true });
});

/** Read the doc's current version the way a client would. */
async function currentVersion(): Promise<string> {
	const read = await service.readSource(abs);
	if (read.kind !== "ok") throw new Error(`expected ok, got ${read.kind}`);
	return read.source.version;
}

describe("DocsService.readSource", () => {
	it("returns the raw on-disk text with a version token for those bytes", async () => {
		const result = await service.readSource(abs);
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		expect(result.source.text).toBe(ORIGINAL);
		expect(result.source.version).toBe(versionOf(ORIGINAL));
	});

	it("reports a path outside every root as not-found", async () => {
		const secret = path.join(outside, "secret.md");
		await fs.writeFile(secret, "# Secret\n", "utf8");
		expect((await service.readSource(secret)).kind).toBe("not-found");
	});

	it("reports a missing file as not-found", async () => {
		expect((await service.readSource(path.join(root, "gone.md"))).kind).toBe("not-found");
	});

	it("refuses a file over the editor size cap, reporting its size", async () => {
		const huge = path.join(root, "huge.md");
		const body = "x".repeat(MAX_SOURCE_BYTES + 1);
		await fs.writeFile(huge, body, "utf8");
		const result = await service.readSource(huge);
		expect(result.kind).toBe("too-large");
		if (result.kind !== "too-large") return;
		expect(result.size).toBe(body.length);
	});
});

describe("DocsService.saveSection", () => {
	it("replaces exactly the requested line range and returns the new version", async () => {
		const result = await service.saveSection({
			path: abs,
			startLine: 3,
			endLine: 3,
			version: versionOf(ORIGINAL),
			markdown: "changed line",
		});
		const written = "# Title\n\nchanged line\n\nline five\n";
		expect(result).toEqual({ kind: "ok", version: versionOf(written) });
		expect(await fs.readFile(abs, "utf8")).toBe(written);
	});

	it("returns a version the next save can immediately use", async () => {
		const first = await service.saveSection({
			path: abs,
			startLine: 3,
			endLine: 3,
			version: versionOf(ORIGINAL),
			markdown: "first edit",
		});
		expect(first.kind).toBe("ok");
		if (first.kind !== "ok") return;

		const second = await service.saveSection({
			path: abs,
			startLine: 3,
			endLine: 3,
			version: first.version,
			markdown: "second edit",
		});
		expect(second.kind).toBe("ok");
		expect(await fs.readFile(abs, "utf8")).toBe("# Title\n\nsecond edit\n\nline five\n");
	});

	it("rejects a version that no longer matches the file, handing back the current one", async () => {
		await fs.writeFile(abs, "# Title\n\nsomeone else wrote this\n", "utf8");
		const result = await service.saveSection({
			path: abs,
			startLine: 3,
			endLine: 3,
			version: versionOf(ORIGINAL),
			markdown: "my edit",
		});
		expect(result).toEqual({ kind: "stale", version: await currentVersion() });
		expect(await fs.readFile(abs, "utf8")).toBe("# Title\n\nsomeone else wrote this\n");
	});

	it("catches a change an mtime check would miss, because it compares bytes", async () => {
		// Rewrite the file with a preserved mtime — exactly what a coarse
		// timestamp looks like from the service's side.
		const { atime, mtime } = await fs.stat(abs);
		await fs.writeFile(abs, "# Title\n\ndifferent content\n", "utf8");
		await fs.utimes(abs, atime, mtime);

		const result = await service.saveSection({
			path: abs,
			startLine: 3,
			endLine: 3,
			version: versionOf(ORIGINAL),
			markdown: "my edit",
		});
		expect(result.kind).toBe("stale");
	});

	it("accepts a save when the file was edited back to the bytes it was read at", async () => {
		await fs.writeFile(abs, "# Title\n\nbriefly different\n", "utf8");
		await fs.writeFile(abs, ORIGINAL, "utf8");
		const result = await service.saveSection({
			path: abs,
			startLine: 3,
			endLine: 3,
			version: versionOf(ORIGINAL),
			markdown: "my edit",
		});
		expect(result.kind).toBe("ok");
	});

	it("rejects a line range past the end of the file without writing", async () => {
		const result = await service.saveSection({
			path: abs,
			startLine: 3,
			endLine: 99,
			version: versionOf(ORIGINAL),
			markdown: "changed",
		});
		expect(result.kind).toBe("invalid-range");
		expect(await fs.readFile(abs, "utf8")).toBe(ORIGINAL);
	});

	it("rejects markdown that would break the doc, reporting the diagnostics, without writing", async () => {
		const result = await service.saveSection({
			path: abs,
			startLine: 3,
			endLine: 3,
			version: versionOf(ORIGINAL),
			markdown: "<Calout>not a real component</Calout>",
		});
		expect(result.kind).toBe("invalid-doc");
		if (result.kind !== "invalid-doc") return;
		expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(true);
		expect(await fs.readFile(abs, "utf8")).toBe(ORIGINAL);
	});

	it("rejects a section save that introduces a mermaid pie fence, without writing", async () => {
		const result = await service.saveSection({
			path: abs,
			startLine: 3,
			endLine: 3,
			version: versionOf(ORIGINAL),
			markdown: '```mermaid\npie title Pets\n  "Dogs" : 40\n```',
		});
		expect(result.kind).toBe("invalid-doc");
		if (result.kind !== "invalid-doc") return;
		expect(result.diagnostics.some((diagnostic) => diagnostic.code === "mermaid-chart")).toBe(true);
		expect(await fs.readFile(abs, "utf8")).toBe(ORIGINAL);
	});

	it("reports a path outside every root as not-found", async () => {
		const secret = path.join(outside, "secret.md");
		await fs.writeFile(secret, "# Secret\n", "utf8");
		const result = await service.saveSection({
			path: secret,
			startLine: 1,
			endLine: 1,
			version: versionOf("# Secret\n"),
			markdown: "owned",
		});
		expect(result.kind).toBe("not-found");
		expect(await fs.readFile(secret, "utf8")).toBe("# Secret\n");
	});

	it("leaves no staging file behind, on success or on rejection", async () => {
		await service.saveSection({
			path: abs,
			startLine: 3,
			endLine: 3,
			version: versionOf(ORIGINAL),
			markdown: "changed",
		});
		await service.saveSection({
			path: abs,
			startLine: 3,
			endLine: 3,
			version: versionOf(ORIGINAL),
			markdown: "stale write",
		});
		const leftovers = (await fs.readdir(root)).filter((name) => name.endsWith(".mdxserve-tmp"));
		expect(leftovers).toEqual([]);
	});

	it("writes through a symlink to its target, leaving the link a link", async () => {
		const link = path.join(root, "alias.md");
		await fs.symlink(abs, link);
		const result = await service.saveSection({
			path: link,
			startLine: 3,
			endLine: 3,
			version: versionOf(ORIGINAL),
			markdown: "via the link",
		});
		expect(result.kind).toBe("ok");
		expect((await fs.lstat(link)).isSymbolicLink()).toBe(true);
		expect(await fs.readFile(abs, "utf8")).toBe("# Title\n\nvia the link\n\nline five\n");
	});

	it("preserves the file's mode across the atomic replace", async () => {
		await fs.chmod(abs, 0o640);
		const before = (await fs.stat(abs)).mode;
		await service.saveSection({
			path: abs,
			startLine: 3,
			endLine: 3,
			version: versionOf(ORIGINAL),
			markdown: "changed",
		});
		expect((await fs.stat(abs)).mode).toBe(before);
	});
});
