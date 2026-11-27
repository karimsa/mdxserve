import path from "node:path";
import { describe, expect, it } from "vitest";
import { runRootsAdd, runRootsList, runRootsRemove } from "../../src/cli/roots.js";
import { NO_SERVER_MESSAGE } from "../../src/cli/format.js";
import { fakeLiveServer } from "../helpers/remote.js";

const deps = (server = fakeLiveServer()) => ({ server, cwd: "/work", home: "/home/me" });

describe("runRootsAdd / runRootsRemove / runRootsList", () => {
	it("add proxies resolved dirs and prints Added / Now serving", async () => {
		const calls: string[][] = [];
		const server = fakeLiveServer({
			remote: {
				addRoots: async (dirs) => {
					calls.push(dirs);
					return { kind: "ok", value: { added: dirs, roots: [{ name: "x", dir: dirs[0] }] } };
				},
			},
		});
		const outcome = await runRootsAdd(["rel/x", "~/y"], {}, deps(server));
		expect(calls).toEqual([[path.resolve("/work", "rel/x"), "/home/me/y"]]);
		expect(outcome.exitCode).toBe(0);
		expect(outcome.stdout).toEqual([
			`Added ${path.resolve("/work", "rel/x")}`,
			"Added /home/me/y",
			"Now serving:",
			path.resolve("/work", "rel/x"),
		]);
	});

	it("remove proxies and prints Removed / Now serving: (none)", async () => {
		const server = fakeLiveServer({
			remote: {
				removeRoots: async (dirs) => ({ kind: "ok", value: { removed: dirs, roots: [] } }),
			},
		});
		const outcome = await runRootsRemove(["/a"], {}, deps(server));
		expect(outcome.stdout).toEqual(["Removed /a", "Now serving:", "(none)"]);
	});

	it("list prints dirs, or (none)", async () => {
		const server = fakeLiveServer({
			remote: {
				listRoots: async () => ({
					kind: "ok",
					value: { roots: [{ name: "docs", dir: "/somewhere/docs" }] },
				}),
			},
		});
		expect((await runRootsList({}, { server })).stdout).toEqual(["/somewhere/docs"]);
		const empty = fakeLiveServer({
			remote: { listRoots: async () => ({ kind: "ok", value: { roots: [] } }) },
		});
		expect((await runRootsList({}, { server: empty })).stdout).toEqual(["(none)"]);
	});

	it("unavailable remote and missing server report the no-server message, exit 1", async () => {
		const expected = [`mdxserve: ${NO_SERVER_MESSAGE}`];
		for (const server of [fakeLiveServer(), fakeLiveServer({ running: false })]) {
			for (const outcome of [
				await runRootsAdd(["/a"], {}, deps(server)),
				await runRootsRemove(["/a"], {}, deps(server)),
				await runRootsList({}, { server }),
			]) {
				expect(outcome.exitCode).toBe(1);
				expect(outcome.stderr).toEqual(expected);
			}
		}
	});

	it("surfaces a remote error", async () => {
		const server = fakeLiveServer({
			remote: {
				addRoots: async () => ({ kind: "error", message: "nested inside an existing root" }),
				removeRoots: async () => ({ kind: "error", message: "not mounted" }),
				listRoots: async () => ({ kind: "error", message: "boom" }),
			},
		});
		expect((await runRootsAdd(["/a"], {}, deps(server))).stderr).toEqual([
			"mdxserve: nested inside an existing root",
		]);
		expect((await runRootsRemove(["/a"], {}, deps(server))).stderr).toEqual([
			"mdxserve: not mounted",
		]);
		expect((await runRootsList({}, { server })).stderr).toEqual(["mdxserve: boom"]);
	});

	it("--json prints the result objects", async () => {
		const server = fakeLiveServer({
			remote: {
				addRoots: async () => ({
					kind: "ok",
					value: { added: ["/a"], roots: [{ name: "a", dir: "/a" }] },
				}),
				removeRoots: async () => ({ kind: "ok", value: { removed: ["/a"], roots: [] } }),
				listRoots: async () => ({
					kind: "ok",
					value: { roots: [{ name: "a", dir: "/a" }] },
				}),
			},
		});
		const added = await runRootsAdd(["/a"], { json: true }, deps(server));
		expect(JSON.parse(added.stdout[0])).toEqual({
			added: ["/a"],
			roots: [{ name: "a", dir: "/a" }],
		});
		const removed = await runRootsRemove(["/a"], { json: true }, deps(server));
		expect(JSON.parse(removed.stdout[0])).toEqual({ removed: ["/a"], roots: [] });
		const listed = await runRootsList({ json: true }, { server });
		expect(JSON.parse(listed.stdout[0])).toEqual({ roots: [{ name: "a", dir: "/a" }] });
	});
});
