import { describe, expect, it } from "vitest";
import { rootFileUrl } from "../../src/docs/asset-url.js";

describe("rootFileUrl", () => {
	it("resolves against the document's directory and encodes each segment", () => {
		expect(rootFileUrl("./img/my shot.png", "/docs/guide.md")).toBe("/docs/img/my%20shot.png");
		expect(rootFileUrl("../a.png", "/docs/sub/guide.md")).toBe("/docs/a.png");
	});

	it("encodes # and ? in a directory name so they stay part of the path", () => {
		expect(rootFileUrl("shot.png", "/docs/release#1/guide.md")).toBe("/docs/release%231/shot.png");
		expect(rootFileUrl("shot.png", "/docs/what?/guide.md")).toBe("/docs/what%3F/shot.png");
	});

	it("decodes an already-encoded relative path once, and keeps a query or fragment", () => {
		expect(rootFileUrl("a%23b.png", "/docs/guide.md")).toBe("/docs/a%23b.png");
		expect(rootFileUrl("my%20shot.png?raw#top", "/docs/guide.md")).toBe(
			"/docs/my%20shot.png?raw#top",
		);
		expect(rootFileUrl("bad%zz.png", "/docs/guide.md")).toBe("/docs/bad%25zz.png");
	});

	it("leaves the path as written when the document path is not absolute", () => {
		expect(rootFileUrl("./a.png", "guide.md")).toBe("./a.png");
	});
});
