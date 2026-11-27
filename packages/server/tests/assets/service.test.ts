import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AssetsService } from "../../src/assets/service.js";

let base: string;
let root: string;
let outside: string;

beforeAll(async () => {
	base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-assets-")));
	root = path.join(base, "root");
	outside = path.join(base, "outside");
	await fs.mkdir(path.join(root, "img"), { recursive: true });
	await fs.mkdir(path.join(root, ".github"), { recursive: true });
	await fs.mkdir(path.join(root, ".git"), { recursive: true });
	await fs.mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
	await fs.mkdir(outside, { recursive: true });
	await fs.writeFile(path.join(root, "img", "shot.png"), "png");
	await fs.writeFile(path.join(root, "img", "diagram.svg"), "<svg/>");
	await fs.writeFile(path.join(root, ".github", "logo.png"), "logo");
	await fs.writeFile(path.join(root, ".git", "config"), "[core]");
	await fs.writeFile(path.join(root, ".env"), "SECRET=1");
	await fs.writeFile(path.join(root, ".env.local"), "SECRET=2");
	await fs.writeFile(path.join(root, "server.pem"), "key");
	await fs.writeFile(path.join(root, "node_modules", "pkg", "a.png"), "dep");
	await fs.writeFile(path.join(root, "guide.md"), "# Guide\n");
	await fs.writeFile(path.join(root, "page.MDX"), "# Page\n");
	await fs.writeFile(path.join(outside, "secret.png"), "secret");
	await fs.writeFile(path.join(outside, "notes.md"), "# Notes\n");
	await fs.symlink(path.join(outside, "secret.png"), path.join(root, "link-out.png"));
	await fs.symlink(outside, path.join(root, "dir-out"), "dir");
	await fs.symlink(path.join(root, "guide.md"), path.join(root, "guide-alias.png"));
	await fs.symlink(path.join(root, ".github", "logo.png"), path.join(root, "logo-alias.png"));
	await fs.symlink(path.join(root, "img", "shot.png"), path.join(root, "shot-alias.png"));
});

afterAll(async () => {
	await fs.rm(base, { recursive: true, force: true });
});

function service(): AssetsService {
	return new AssetsService([{ name: "root", dir: root }]);
}

describe("AssetsService.locate", () => {
	it("finds a file in a root with its size and content type", async () => {
		const located = await service().locate(path.join(root, "img", "shot.png"), false);
		expect(located).toMatchObject({
			kind: "ok",
			abs: path.join(root, "img", "shot.png"),
			size: 3,
			contentType: "image/png",
		});
		const svg = await service().locate(path.join(root, "img", "diagram.svg"), false);
		expect(svg).toMatchObject({ kind: "ok", contentType: "image/svg+xml" });
	});

	it("follows a symlink that stays inside the root", async () => {
		const located = await service().locate(path.join(root, "shot-alias.png"), true);
		expect(located).toMatchObject({ kind: "ok", abs: path.join(root, "img", "shot.png") });
	});

	it.each([
		["a path outside every root", () => path.join(outside, "secret.png")],
		["a .. segment that climbs out", () => `${root}/img/../../outside/secret.png`],
		["a symlinked file that points out", () => path.join(root, "link-out.png")],
		[
			"a file under a symlinked directory that points out",
			() => path.join(root, "dir-out", "secret.png"),
		],
		["a document", () => path.join(root, "guide.md")],
		["a document in upper case", () => path.join(root, "page.MDX")],
		["a document through an image-named symlink", () => path.join(root, "guide-alias.png")],
		["a document outside every root", () => path.join(outside, "notes.md")],
		["the git directory", () => path.join(root, ".git", "config")],
		["an environment file", () => path.join(root, ".env")],
		["an environment variant", () => path.join(root, ".env.local")],
		["a key", () => path.join(root, "server.pem")],
		["a directory", () => path.join(root, "img")],
		["the root itself", () => root],
		["a missing file", () => path.join(root, "img", "missing.png")],
		["a relative path", () => "img/shot.png"],
		["a path with a NUL byte", () => `${path.join(root, "img", "shot.png")}\0.txt`],
	])("refuses %s in either mode", async (_label, target) => {
		for (const publicOnly of [false, true]) {
			expect((await service().locate(target(), publicOnly)).kind).toBe("not-found");
		}
	});

	it("serves hidden and node_modules paths to a full reader only", async () => {
		for (const target of [
			path.join(root, ".github", "logo.png"),
			path.join(root, "node_modules", "pkg", "a.png"),
			path.join(root, "logo-alias.png"),
		]) {
			expect((await service().locate(target, false)).kind).toBe("ok");
			expect((await service().locate(target, true)).kind).toBe("not-found");
		}
	});

	it("refuses everything when no root is mounted", async () => {
		const located = await new AssetsService([]).locate(path.join(root, "img", "shot.png"), false);
		expect(located.kind).toBe("not-found");
	});
});
