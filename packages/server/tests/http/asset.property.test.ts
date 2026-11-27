import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type http from "node:http";
import * as fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET_ASSET_PATH } from "../../src/assets/url.js";
import { makeRequestContext, startTestServer } from "../helpers/http.js";
import { fixtureRegistry as registry } from "../fixtures/registry.js";

let base: string;
let root: string;
const servers: http.Server[] = [];
const urls: Record<"full" | "restricted", string> = { full: "", restricted: "" };

beforeAll(async () => {
	base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-get-asset-prop-")));
	root = path.join(base, "root");
	await fs.mkdir(path.join(root, "img"), { recursive: true });
	await fs.mkdir(path.join(root, ".hidden"), { recursive: true });
	await fs.writeFile(path.join(root, "img", "a.png"), "public");
	await fs.writeFile(path.join(root, ".hidden", "b.png"), "hidden");
	await fs.writeFile(path.join(root, "guide.md"), "document");
	await fs.writeFile(path.join(base, "secret.png"), "secret");
	await fs.symlink(path.join(base, "secret.png"), path.join(root, "img", "link.png"));
	for (const permissions of ["full", "restricted"] as const) {
		const started = await startTestServer(makeRequestContext(root, registry, { permissions }));
		servers.push(started.server);
		urls[permissions] = started.base;
	}
});

afterAll(async () => {
	for (const server of servers) server.close();
	await fs.rm(base, { recursive: true, force: true });
});

const segment = fc.oneof(
	fc.constantFrom(
		"img",
		"a.png",
		"link.png",
		".hidden",
		"b.png",
		"guide.md",
		"..",
		".",
		"secret.png",
	),
	fc.string({ unit: fc.constantFrom("a", ".", "/", "\\", "%", "\0", "~", " "), maxLength: 6 }),
);

describe("getAsset over HTTP", () => {
	it("answers any path with a file from inside the root or a refusal", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.array(segment, { maxLength: 6 }),
				fc.boolean(),
				fc.constantFrom("full" as const, "restricted" as const),
				async (segments, absolute, permissions) => {
					const requested = `${absolute ? `${root}/` : ""}${segments.join("/")}`;
					const query = new URLSearchParams({ path: requested }).toString();
					const response = await fetch(`${urls[permissions]}${GET_ASSET_PATH}?${query}`);
					const body = await response.text();
					expect([200, 400, 404]).toContain(response.status);
					if (response.status !== 200) return;
					expect(body).not.toBe("secret");
					expect(body).not.toBe("document");
					if (permissions === "restricted") expect(body).not.toBe("hidden");
				},
			),
			{ numRuns: 150 },
		);
	});
});
