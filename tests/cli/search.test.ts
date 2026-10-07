import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runSearch } from "../../src/cli/search.js";
import { NO_ROOTS_MESSAGE, NO_SERVER_MESSAGE } from "../../src/cli/format.js";
import type { SearchResult } from "../../src/search/service.js";
import { fakeLiveServer } from "../helpers/remote.js";

let fixtureDir: string;

beforeAll(async () => {
	fixtureDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-cli-search-")));
	await fs.writeFile(
		path.join(fixtureDir, "good.md"),
		"# Good doc\n\nSome plain content about widgets and gadgets.\n",
		"utf8",
	);
});

afterAll(async () => {
	await fs.rm(fixtureDir, { recursive: true, force: true });
});

const canned: SearchResult[] = [
	{
		path: "/remote/only.md",
		label: "remote/only.md",
		title: "Remote only",
		excerpt: "This result only exists on the remote server.",
		terms: ["widgets"],
		score: 5,
	},
];

describe("runSearch", () => {
	it("prefers a remote ok result over the local index", async () => {
		const server = fakeLiveServer({
			snapshot: [{ name: "docs", dir: fixtureDir }],
			remote: { searchDocs: async () => ({ kind: "ok", value: canned }) },
		});
		const outcome = await runSearch("widgets", {}, { server });
		expect(outcome.exitCode).toBe(0);
		expect(outcome.stdout.join("\n")).toContain("This result only exists on the remote server.");
	});

	it("fails with the message on a remote error", async () => {
		const server = fakeLiveServer({
			snapshot: [{ name: "docs", dir: fixtureDir }],
			remote: { searchDocs: async () => ({ kind: "error", message: "the remote exploded" }) },
		});
		const outcome = await runSearch("widgets", {}, { server });
		expect(outcome.exitCode).toBe(1);
		expect(outcome.stderr).toEqual(["mdxserve: the remote exploded"]);
	});

	it("uses the local index when the remote is unavailable", async () => {
		const server = fakeLiveServer({ snapshot: [{ name: "docs", dir: fixtureDir }] });
		const outcome = await runSearch("widgets", {}, { server });
		expect(outcome.exitCode).toBe(0);
		expect(outcome.stdout.join("\n")).toContain("good.md");
	});

	it("zero matches is exit 0", async () => {
		const server = fakeLiveServer({ snapshot: [{ name: "docs", dir: fixtureDir }] });
		const outcome = await runSearch("zzzqqq", {}, { server });
		expect(outcome.exitCode).toBe(0);
		expect(outcome.stdout).toEqual(['No docs match "zzzqqq".']);
	});

	it("reports no server", async () => {
		const outcome = await runSearch("x", {}, { server: fakeLiveServer({ running: false }) });
		expect(outcome.exitCode).toBe(1);
		expect(outcome.stderr).toEqual([`mdxserve: ${NO_SERVER_MESSAGE}`]);
	});

	it("reports no roots", async () => {
		const outcome = await runSearch("x", {}, { server: fakeLiveServer({ snapshot: [] }) });
		expect(outcome.exitCode).toBe(1);
		expect(outcome.stderr).toEqual([`mdxserve: ${NO_ROOTS_MESSAGE}`]);
	});

	it("--json prints { results }", async () => {
		const server = fakeLiveServer({
			snapshot: [{ name: "docs", dir: fixtureDir }],
			remote: { searchDocs: async () => ({ kind: "ok", value: canned }) },
		});
		const outcome = await runSearch("widgets", { json: true }, { server });
		expect(JSON.parse(outcome.stdout[0])).toEqual({ results: canned });
	});
});
