import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createCallerFactory } from "../../src/api/trpc.js";
import { appRouter } from "../../src/api/router.js";
import { fixtureRegistry as registry } from "../fixtures/registry.js";
import { makeContext } from "../helpers/context.js";

// The controller constructs TrashService with its real `trash` default, which
// is the code path that actually ships — so stub the module rather than
// threading a spy through the context, and the procedure under test stays
// exactly the one that runs in production.
const trashed: string[] = [];
vi.mock("trash", () => ({
	default: async (absPath: string) => {
		trashed.push(absPath);
		await fs.rm(absPath, { force: true });
	},
}));

const createCaller = createCallerFactory(appRouter);

let fixtureDir: string;
let outsideDir: string;

beforeEach(async () => {
	trashed.length = 0;
	fixtureDir = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-trash-controller-")),
	);
	outsideDir = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-trash-controller-outside-")),
	);
	await fs.writeFile(path.join(fixtureDir, "one.md"), "# One\n", "utf8");
	await fs.writeFile(path.join(fixtureDir, "two.md"), "# Two\n", "utf8");
	await fs.mkdir(path.join(fixtureDir, "sub"));
	await fs.writeFile(path.join(outsideDir, "secret.md"), "# Secret\n", "utf8");
});

afterAll(async () => {
	await fs.rm(fixtureDir, { recursive: true, force: true });
	await fs.rm(outsideDir, { recursive: true, force: true });
});

function caller() {
	return createCaller(makeContext(fixtureDir, registry));
}

describe("moveDocsToTrash", () => {
	it("trashes the requested docs and reports them as deleted", async () => {
		const first = path.join(fixtureDir, "one.md");
		const second = path.join(fixtureDir, "two.md");
		const result = await caller().moveDocsToTrash({ paths: [first, second] });

		expect(result).toEqual({ deleted: [first, second], failed: [] });
		expect(trashed).toEqual([first, second]);
		expect(await fs.readdir(fixtureDir)).toEqual(["sub"]);
	});

	it("reports each failure with its own path and reason, in the order asked for", async () => {
		const missing = path.join(fixtureDir, "gone.md");
		const directory = path.join(fixtureDir, "sub");
		const outside = path.join(outsideDir, "secret.md");
		const result = await caller().moveDocsToTrash({ paths: [missing, directory, outside] });

		expect(result.deleted).toEqual([]);
		expect(result.failed).toEqual([
			{ path: missing, error: "Not found" },
			{ path: directory, error: "Is a directory" },
			{ path: outside, error: "Invalid path" },
		]);
		expect(trashed).toEqual([]);
		expect(await fs.readFile(outside, "utf8")).toBe("# Secret\n");
	});

	it("partitions a mixed batch instead of failing it whole", async () => {
		const good = path.join(fixtureDir, "one.md");
		const bad = path.join(outsideDir, "secret.md");
		const result = await caller().moveDocsToTrash({ paths: [good, bad] });

		expect(result.deleted).toEqual([good]);
		expect(result.failed).toEqual([{ path: bad, error: "Invalid path" }]);
	});

	it("rejects an empty batch at the schema, before any file is touched", async () => {
		await expect(caller().moveDocsToTrash({ paths: [] })).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
		expect(trashed).toEqual([]);
	});

	it("rejects a batch over the 500-path cap at the schema", async () => {
		const paths = Array.from({ length: 501 }, (_unused, index) =>
			path.join(fixtureDir, `doc-${index}.md`),
		);
		await expect(caller().moveDocsToTrash({ paths })).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
		expect(trashed).toEqual([]);
	});

	it("is rejected as a cross-origin write, being a mutation", async () => {
		const crossOrigin = createCaller(
			makeContext(fixtureDir, registry, {
				origin: "http://evil.example",
				host: "127.0.0.1:4040",
			}),
		);
		await expect(
			crossOrigin.moveDocsToTrash({ paths: [path.join(fixtureDir, "one.md")] }),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(trashed).toEqual([]);
	});
});
