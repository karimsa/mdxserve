import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runDocs } from "../../src/cli/docs.js";
import { NO_ROOTS_MESSAGE, NO_SERVER_MESSAGE } from "../../src/cli/format.js";
import type { DocTreeRoot } from "../../src/listing/controller.js";
import { fakeLiveServer } from "../helpers/remote.js";

let fixtureDir: string;
let otherDir: string;

beforeAll(async () => {
	fixtureDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-cli-docs-")));
	otherDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-cli-docs2-")));
	await fs.writeFile(path.join(fixtureDir, "good.md"), "# Good\n", "utf8");
	await fs.mkdir(path.join(fixtureDir, "sub"));
	await fs.writeFile(path.join(fixtureDir, "sub", "nested.md"), "# Nested\n", "utf8");
	await fs.writeFile(path.join(otherDir, "other.md"), "# Other\n", "utf8");
});

afterAll(async () => {
	await fs.rm(fixtureDir, { recursive: true, force: true });
	await fs.rm(otherDir, { recursive: true, force: true });
});

function localDeps(overrides: { cwd?: string } = {}) {
	return {
		server: fakeLiveServer({
			snapshot: [
				{ name: path.basename(fixtureDir), dir: fixtureDir },
				{ name: path.basename(otherDir), dir: otherDir },
			],
		}),
		cwd: overrides.cwd ?? fixtureDir,
		home: os.homedir(),
	};
}

describe("runDocs", () => {
	it("lists all roots when unavailable falls back to the local walk", async () => {
		const outcome = await runDocs(undefined, { depth: "8" }, localDeps());
		expect(outcome.exitCode).toBe(0);
		const text = outcome.stdout.join("\n");
		expect(text).toContain(`${path.basename(fixtureDir)} (${fixtureDir})`);
		expect(text).toContain("  good.md");
		expect(text).toContain("    nested.md");
		expect(text).toContain("other.md");
	});

	it("lists one directory with the cwd-resolved path in the header", async () => {
		const outcome = await runDocs("sub", { depth: "8" }, localDeps());
		expect(outcome.exitCode).toBe(0);
		const text = outcome.stdout.join("\n");
		expect(text).toContain(`(${path.join(fixtureDir, "sub")})`);
		expect(text).toContain("nested.md");
		expect(text).not.toContain("other.md");
	});

	it("fails for a directory outside every root", async () => {
		const outcome = await runDocs("/", { depth: "8" }, localDeps());
		expect(outcome.exitCode).toBe(1);
	});

	it.each(["0", "9", "abc", "1.5", ""])("rejects --depth %j", async (depth) => {
		const outcome = await runDocs(undefined, { depth }, localDeps());
		expect(outcome.exitCode).toBe(1);
		expect(outcome.stderr[0]).toContain("--depth");
	});

	it("prefers a remote ok result and passes the resolved dir and depth", async () => {
		const canned: DocTreeRoot[] = [{ name: "remote-root", dir: "/remote/root", nodes: [] }];
		const calls: Array<[string | undefined, number]> = [];
		const server = fakeLiveServer({
			snapshot: [{ name: "docs", dir: fixtureDir }],
			remote: {
				listDocs: async (dirPath, maxDepth) => {
					calls.push([dirPath, maxDepth]);
					return { kind: "ok", value: canned };
				},
			},
		});
		const outcome = await runDocs("sub", { depth: "3" }, { server, cwd: fixtureDir, home: "/h" });
		expect(outcome.stdout.join("\n")).toContain(`remote-root (${path.join(fixtureDir, "sub")})`);
		expect(calls).toEqual([[path.join(fixtureDir, "sub"), 3]]);
	});

	it("fails with the message on a remote error", async () => {
		const server = fakeLiveServer({
			snapshot: [{ name: "docs", dir: fixtureDir }],
			remote: { listDocs: async () => ({ kind: "error", message: "no such directory" }) },
		});
		const outcome = await runDocs(undefined, { depth: "8" }, { server, cwd: "/", home: "/h" });
		expect(outcome.exitCode).toBe(1);
		expect(outcome.stderr).toEqual(["mdxserve: no such directory"]);
	});

	it("reports no server and no roots", async () => {
		const noServer = await runDocs(
			undefined,
			{ depth: "8" },
			{ server: fakeLiveServer({ running: false }), cwd: "/", home: "/h" },
		);
		expect(noServer.stderr).toEqual([`mdxserve: ${NO_SERVER_MESSAGE}`]);
		const noRoots = await runDocs(
			undefined,
			{ depth: "8" },
			{ server: fakeLiveServer({ snapshot: [] }), cwd: "/", home: "/h" },
		);
		expect(noRoots.stderr).toEqual([`mdxserve: ${NO_ROOTS_MESSAGE}`]);
	});

	it("--json prints { roots }", async () => {
		const outcome = await runDocs(undefined, { depth: "8", json: true }, localDeps());
		const parsed = JSON.parse(outcome.stdout[0]) as { roots: DocTreeRoot[] };
		expect(parsed.roots.map((rootEntry) => rootEntry.dir)).toEqual([fixtureDir, otherDir]);
	});
});
