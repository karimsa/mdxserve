import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runDocument } from "../../src/cli/document.js";
import { documentTreeSchema } from "../../src/document/schema.js";
import { builtinRegistry } from "../helpers/components.js";

let fixtureDir: string;

beforeAll(async () => {
	fixtureDir = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-cli-document-")),
	);
	await fs.writeFile(
		path.join(fixtureDir, "guide.md"),
		'---\ntitle: The guide\n---\n\n# Guide\n\n## Install\n\n<Tabs id="os">\n  <Tab label="Mac">\n    brew\n  </Tab>\n</Tabs>\n',
		"utf8",
	);
	await fs.writeFile(path.join(fixtureDir, "notes.txt"), "not a doc\n", "utf8");
});

afterAll(async () => {
	await fs.rm(fixtureDir, { recursive: true, force: true });
});

const deps = () => ({ registry: builtinRegistry, cwd: fixtureDir, home: os.homedir() });

describe("runDocument", () => {
	it("prints the document tree as JSON with --json, resolving the path against the cwd", async () => {
		const outcome = await runDocument("guide.md", { json: true }, deps());
		expect(outcome.exitCode).toBe(0);
		const tree = documentTreeSchema.parse(JSON.parse(outcome.stdout.join("\n")));
		expect(tree.metadata.title).toBe("The guide");
		expect(tree.toc).toMatchObject([
			{ id: "install", kind: "heading", children: [{ id: "os>mac", kind: "tab", label: "Mac" }] },
		]);
	});

	it("prints the table of contents with each anchor without --json", async () => {
		const outcome = await runDocument(path.join(fixtureDir, "guide.md"), {}, deps());
		expect(outcome.exitCode).toBe(0);
		const text = outcome.stdout.join("\n");
		expect(text).toContain("The guide");
		expect(text).toContain("  Install  #install");
		expect(text).toContain("    [tab] Mac  #os>mac");
	});

	it("fails for a file that is not a document", async () => {
		const outcome = await runDocument("notes.txt", { json: true }, deps());
		expect(outcome.exitCode).toBe(1);
		expect(outcome.stderr.join("\n")).toContain("mdxserve:");
	});

	it("fails for a missing file", async () => {
		const outcome = await runDocument("missing.md", { json: true }, deps());
		expect(outcome.exitCode).toBe(1);
	});
});
