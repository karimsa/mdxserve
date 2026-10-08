import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fc from "fast-check";
import { RootsService } from "../../src/roots/service.js";
import { readConfig, writeConfig } from "../../src/roots/config.js";

let base: string;
let config: string;
let first: string;
let second: string;
const stops: (() => void)[] = [];
const service = () => new RootsService(base, base, [], config);
const dirs = (roots: RootsService) => roots.list().map((root) => root.dir);

beforeEach(async () => {
	base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-config-")));
	config = path.join(base, "config.json");
	first = path.join(base, "first");
	second = path.join(base, "second");
	await Promise.all([fs.mkdir(first), fs.mkdir(second)]);
});
afterEach(async () => {
	for (const stop of stops.splice(0)) stop();
	await fs.rm(base, { recursive: true, force: true });
});

it("persists startup additions, API additions and removals across fresh instances", async () => {
	const initial = service();
	expect((await initial.initialize([first])).kind).toBe("ok");
	expect((await initial.add([second])).kind).toBe("ok");
	const restarted = service();
	expect((await restarted.initialize([])).kind).toBe("ok");
	expect(dirs(restarted)).toEqual([first, second]);
	expect((await restarted.remove([first])).kind).toBe("ok");
	const again = service();
	await again.initialize([]);
	expect(dirs(again)).toEqual([second]);
});

it("preserves user spelling on startup and unrelated settings on mutations", async () => {
	const content = JSON.stringify({ roots: ["~/first"], appearance: { theme: "dark" } });
	await fs.writeFile(config, content);
	const roots = service();
	await roots.initialize([]);
	expect(await fs.readFile(config, "utf8")).toBe(content);
	expect(dirs(roots)).toEqual([first]);
	await roots.add([second]);
	expect(readConfig(config).value).toEqual({
		roots: [first, second],
		appearance: { theme: "dark" },
	});
});

it("reloads edits, atomic replacements, empty roots and recreation after deletion", async () => {
	const roots = service();
	await roots.initialize([first]);
	const onError = vi.fn();
	stops.push(roots.watchConfig(onError));
	await fs.writeFile(config, JSON.stringify({ roots: ["second"] }));
	await vi.waitFor(() => expect(dirs(roots)).toEqual([second]), { timeout: 3000 });
	await fs.writeFile(`${config}.new`, JSON.stringify({ roots: [] }));
	await fs.rename(`${config}.new`, config);
	await vi.waitFor(() => expect(dirs(roots)).toEqual([]), { timeout: 3000 });
	await fs.unlink(config);
	await vi.waitFor(() => expect(onError).toHaveBeenCalled(), { timeout: 3000 });
	await fs.writeFile(config, JSON.stringify({ roots: [first] }));
	await vi.waitFor(() => expect(dirs(roots)).toEqual([first]), { timeout: 3000 });
});

it.each([
	"{",
	'{"roots":42}',
	'{"roots":["/"]}',
	'{"roots":["missing"]}',
	'{"roots":[".","first"]}',
])("keeps the last good roots and refuses to overwrite invalid config: %s", async (content) => {
	const roots = service();
	await roots.initialize([first]);
	await fs.writeFile(config, content);
	expect((await roots.reload()).kind).toBe("config-error");
	expect((await roots.add([second])).kind).toBe("config-error");
	expect(dirs(roots)).toEqual([first]);
	expect(await fs.readFile(config, "utf8")).toBe(content);
	await fs.writeFile(config, JSON.stringify({ roots: [second] }));
	expect((await roots.reload()).kind).toBe("ok");
	expect(dirs(roots)).toEqual([second]);
});

it("reads pending user edits before mutations and removes deleted directories", async () => {
	const roots = service();
	await roots.initialize([first]);
	await fs.writeFile(config, JSON.stringify({ roots: [second] }));
	await roots.add([first]);
	expect(dirs(roots)).toEqual([second, first]);
	await fs.rm(second, { recursive: true });
	expect((await roots.remove([second])).kind).toBe("ok");
	expect(readConfig(config).value.roots).toEqual([first]);
});

it("does not overwrite an intervening user edit", async () => {
	await service().initialize([first]);
	const snapshot = readConfig(config);
	await fs.writeFile(config, JSON.stringify({ roots: [second] }));
	expect(() => writeConfig(config, snapshot, [])).toThrow("configuration changed");
	expect(readConfig(config).value.roots).toEqual([second]);
	expect((await fs.readdir(base)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
});

it("failed writes leave mounted roots unchanged", async () => {
	const roots = service();
	await roots.initialize([first]);
	await fs.unlink(config);
	await fs.mkdir(config);
	expect((await roots.add([second])).kind).toBe("config-error");
	expect(dirs(roots)).toEqual([first]);
});

it("serializes concurrent additions without losing either root", async () => {
	const roots = service();
	await roots.initialize([]);
	const results = await Promise.all([roots.add([first]), roots.add([second])]);
	expect(results.map((result) => result.kind)).toEqual(["ok", "ok"]);
	expect(readConfig(config).value.roots).toEqual([first, second]);
});

it("arbitrary add/remove sequences always survive restart", async () => {
	await fc.assert(
		fc.asyncProperty(fc.array(fc.boolean(), { maxLength: 20 }), async (operations) => {
			await fs.writeFile(config, JSON.stringify({ roots: [] }));
			const roots = service();
			await roots.initialize([]);
			for (const add of operations) {
				if (add) await roots.add([first]);
				else if (dirs(roots).includes(first)) await roots.remove([first]);
				const restored = service();
				expect((await restored.initialize([])).kind).toBe("ok");
				expect(dirs(restored)).toEqual(dirs(roots));
			}
		}),
		{ numRuns: 25 },
	);
});
