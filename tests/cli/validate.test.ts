import type http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runValidate, type ValidateDeps, type ValidateJsonEntry } from "../../src/cli/validate.js";
import { validationResultSchema } from "../../src/validation/controller.js";
import { RemoteClient } from "../../src/servers/remote.js";
import type { ValidationResult } from "../../src/validation/validate.js";
import { fixtureRegistry as registry } from "../fixtures/registry.js";
import { makeRequestContext, startTestServer } from "../helpers/http.js";
import { fakeLiveServer } from "../helpers/remote.js";

let fixtureDir: string;
let outsideDir: string;

beforeAll(async () => {
	fixtureDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-cli-val-")));
	outsideDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-cli-out-")));
	await fs.writeFile(path.join(fixtureDir, "good.md"), "# Good doc\n\nPlain content.\n", "utf8");
	await fs.writeFile(
		path.join(fixtureDir, "bad.mdx"),
		'# Bad doc\n\n<Calout tone="warn">hi</Calout>\n\n<Callout tonee="x">y</Callout>\n',
		"utf8",
	);
	await fs.writeFile(
		path.join(fixtureDir, "warn.mdx"),
		'# Warn\n\n<Callout tonee="x">y</Callout>\n',
		"utf8",
	);
	await fs.writeFile(
		path.join(fixtureDir, "chart.md"),
		'# Chart\n\n```mermaid\npie title Pets\n  "Dogs" : 40\n```\n',
		"utf8",
	);
	await fs.mkdir(path.join(fixtureDir, "sub"));
	await fs.writeFile(path.join(outsideDir, "loose.md"), "# Loose\n", "utf8");
});

afterAll(async () => {
	await fs.rm(fixtureDir, { recursive: true, force: true });
	await fs.rm(outsideDir, { recursive: true, force: true });
});

function deps(overrides: Partial<ValidateDeps> = {}): ValidateDeps {
	return {
		registry,
		server: fakeLiveServer({ running: false }),
		cwd: fixtureDir,
		home: os.homedir(),
		...overrides,
	};
}

const canned: ValidationResult = {
	ok: true,
	path: "/somewhere/else.md",
	diagnostics: [],
	rendered: true,
	hints: [],
};

describe("runValidate static path", () => {
	it("validates an absolute path with no server at all, exit 0", async () => {
		const outcome = await runValidate([path.join(fixtureDir, "good.md")], {}, deps());
		expect(outcome.exitCode).toBe(0);
		expect(outcome.stdout.join("\n")).toContain(`OK: ${path.join(fixtureDir, "good.md")}`);
		expect(outcome.stdout.join("\n")).toContain("Not rendered (");
	});

	it("exits 0 for warnings only and lists them", async () => {
		const outcome = await runValidate([path.join(fixtureDir, "warn.mdx")], {}, deps());
		expect(outcome.exitCode).toBe(0);
		const text = outcome.stdout.join("\n");
		expect(text).toMatch(/^OK with 1 warning:/);
		expect(text).toContain("unknown-prop");
	});

	it("exits 1 for a bad component and prints did you mean", async () => {
		const outcome = await runValidate([path.join(fixtureDir, "bad.mdx")], {}, deps());
		expect(outcome.exitCode).toBe(1);
		const text = outcome.stdout.join("\n");
		expect(text).toContain("unknown-component");
		expect(text).toContain("did you mean: Callout");
	});

	it("reports a pie fence as mermaid-chart", async () => {
		const outcome = await runValidate([path.join(fixtureDir, "chart.md")], {}, deps());
		expect(outcome.exitCode).toBe(1);
		expect(outcome.stdout.join("\n")).toContain("mermaid-chart");
		expect(outcome.stdout.join("\n")).toContain("<Chart>");
	});

	it("falls back to static checks and rejects a file outside every root (stale row)", async () => {
		const server = fakeLiveServer({ snapshot: [{ name: "docs", dir: fixtureDir }] });
		const target = path.join(outsideDir, "loose.md");
		const outcome = await runValidate([target], {}, deps({ server }));
		expect(outcome.exitCode).toBe(1);
		expect(outcome.stdout.join("\n")).toContain(`Not validated: ${target}`);
		expect(outcome.stdout[0]).toMatch(/\n {2}\S/);
	});

	it("rejects a directory path", async () => {
		const outcome = await runValidate([path.join(fixtureDir, "sub")], {}, deps());
		expect(outcome.exitCode).toBe(1);
		expect(outcome.stdout.join("\n")).toContain("Not validated:");
	});

	it("resolves relative paths against deps.cwd and ~/ against deps.home", async () => {
		const relative = await runValidate(["good.md"], {}, deps());
		expect(relative.exitCode).toBe(0);
		expect(relative.stdout.join("\n")).toContain(`OK: ${path.join(fixtureDir, "good.md")}`);

		const tilde = await runValidate(["~/good.md"], {}, deps({ cwd: "/", home: fixtureDir }));
		expect(tilde.exitCode).toBe(0);
		expect(tilde.stdout.join("\n")).toContain(`OK: ${path.join(fixtureDir, "good.md")}`);
	});

	it("never renders on the static path", async () => {
		const outcome = await runValidate([path.join(fixtureDir, "good.md")], { json: true }, deps());
		const entries = JSON.parse(outcome.stdout[0]) as ValidationResult[];
		expect(entries[0].rendered).toBe(false);
	});
});

describe("runValidate with a server", () => {
	it("prints a remote ok result verbatim, with Rendered OK", async () => {
		const server = fakeLiveServer({
			remote: { validateDoc: async () => ({ kind: "ok", value: canned }) },
		});
		const outcome = await runValidate([path.join(fixtureDir, "good.md")], {}, deps({ server }));
		expect(outcome.exitCode).toBe(0);
		expect(outcome.stdout.join("\n")).toBe("OK: /somewhere/else.md\nRendered OK");
	});

	it("reports a remote error as Not validated, exit 1", async () => {
		const server = fakeLiveServer({
			remote: { validateDoc: async () => ({ kind: "error", message: "server exploded" }) },
		});
		const target = path.join(fixtureDir, "good.md");
		const outcome = await runValidate([target], {}, deps({ server }));
		expect(outcome.exitCode).toBe(1);
		expect(outcome.stdout.join("\n")).toBe(`Not validated: ${target}\n  server exploded`);
	});

	it("fails the whole command when listing roots errors", async () => {
		const server = fakeLiveServer({
			remote: { listRoots: async () => ({ kind: "error", message: "boom" }) },
		});
		const outcome = await runValidate([path.join(fixtureDir, "good.md")], {}, deps({ server }));
		expect(outcome.exitCode).toBe(1);
		expect(outcome.stderr).toEqual(["mdxserve: boom"]);
	});
});

describe("runValidate with several paths", () => {
	it("prints blocks separated by a blank line and a summary", async () => {
		const outcome = await runValidate(
			[
				path.join(fixtureDir, "good.md"),
				path.join(fixtureDir, "warn.mdx"),
				path.join(fixtureDir, "bad.mdx"),
				path.join(fixtureDir, "missing.md"),
			],
			{},
			deps(),
		);
		expect(outcome.exitCode).toBe(1);
		const text = outcome.stdout.join("\n");
		expect(text).toContain("\n\nOK with 1 warning:");
		expect(text.split("\n").at(-1)).toBe(
			"4 files: 1 ok, 1 with warnings, 1 with errors, 1 not validated",
		);
	});

	it("omits the summary for a single path", async () => {
		const outcome = await runValidate([path.join(fixtureDir, "good.md")], {}, deps());
		expect(outcome.stdout.join("\n")).not.toContain("files:");
	});
});

describe("runValidate --json", () => {
	it("prints an array whose entries parse with validationResultSchema or carry an error", async () => {
		const outcome = await runValidate(
			[path.join(fixtureDir, "bad.mdx"), path.join(fixtureDir, "missing.md")],
			{ json: true },
			deps(),
		);
		expect(outcome.exitCode).toBe(1);
		const entries = JSON.parse(outcome.stdout[0]) as ValidateJsonEntry[];
		expect(entries).toHaveLength(2);
		expect(validationResultSchema.safeParse(entries[0]).success).toBe(true);
		expect(entries[1]).toMatchObject({ path: path.join(fixtureDir, "missing.md") });
		expect(typeof (entries[1] as { error: string }).error).toBe("string");
	});
});

describe("runValidate over a real server", () => {
	let realServer: http.Server;
	let port: number;

	beforeAll(async () => {
		const started = await startTestServer(makeRequestContext(fixtureDir, registry));
		realServer = started.server;
		port = Number(new URL(started.base).port);
	});

	afterAll(() => {
		realServer.close();
	});

	it("validates through a real RemoteClient and rejects files outside the roots", async () => {
		const record = { pid: process.pid, host: "127.0.0.1", port, roots: [fixtureDir], startedAt: 0 };
		const server = {
			serverRunning: () => true,
			snapshotRoots: () => [{ name: path.basename(fixtureDir), dir: fixtureDir }],
			remote: new RemoteClient(() => record),
		};
		const good = await runValidate([path.join(fixtureDir, "good.md")], {}, deps({ server }));
		expect(good.exitCode).toBe(0);
		expect(good.stdout.join("\n")).toContain(`OK: ${path.join(fixtureDir, "good.md")}`);

		const outside = await runValidate([path.join(outsideDir, "loose.md")], {}, deps({ server }));
		expect(outside.exitCode).toBe(1);
		expect(outside.stdout.join("\n")).toContain("Not validated:");
	});
});
