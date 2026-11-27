import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readOrCreateServerId } from "../../src/server-info/server-id.js";

let folder: string;
let file: string;

beforeEach(() => {
	folder = fs.mkdtempSync(path.join(os.tmpdir(), "mdxserve-server-id-"));
	file = path.join(folder, "home", "config.json");
});

afterEach(() => {
	fs.rmSync(folder, { recursive: true, force: true });
});

describe("readOrCreateServerId", () => {
	it("creates a UUID on first start and returns the same one afterwards", () => {
		const first = readOrCreateServerId(file);
		expect(first.kind).toBe("ok");
		const id = first.kind === "ok" ? first.id : "";
		expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		expect(readOrCreateServerId(file)).toEqual({ kind: "ok", id });
		expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ roots: [], serverId: id });
	});

	it("keeps the roots and every other key in an existing config", () => {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		const existing = { roots: ["/notes"], diagrams: { agent: "codex" } };
		fs.writeFileSync(file, JSON.stringify(existing));
		const result = readOrCreateServerId(file);
		expect(result.kind).toBe("ok");
		expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({
			...existing,
			serverId: result.kind === "ok" ? result.id : undefined,
		});
	});

	it("refuses a serverId that is not a UUID and leaves the file alone", () => {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		const content = JSON.stringify({ roots: [], serverId: "box" });
		fs.writeFileSync(file, content);
		expect(readOrCreateServerId(file)).toMatchObject({ kind: "error" });
		expect(fs.readFileSync(file, "utf8")).toBe(content);
	});

	it("reports a config that is not JSON as an error", () => {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, "{");
		expect(readOrCreateServerId(file)).toMatchObject({ kind: "error" });
	});
});
