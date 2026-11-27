import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { assetUrl, GET_ASSET_PATH, getAssetUrl } from "../../src/assets/url.js";

/** The absolute path a `getAsset` URL names, and its fragment. */
function decode(url: string): { path: string | null; hash: string } {
	const parsed = new URL(url, "http://localhost");
	expect(parsed.pathname).toBe(GET_ASSET_PATH);
	return { path: parsed.searchParams.get("path"), hash: parsed.hash };
}

describe("assetUrl", () => {
	it("resolves against the document's directory", () => {
		expect(decode(assetUrl("./img/my shot.png", "/docs/guide.md")).path).toBe(
			"/docs/img/my shot.png",
		);
		expect(decode(assetUrl("../a.png", "/docs/sub/guide.md")).path).toBe("/docs/a.png");
		expect(decode(assetUrl("/elsewhere/a.png", "/docs/guide.md")).path).toBe("/elsewhere/a.png");
	});

	it("keeps # and ? in a directory name as part of the path", () => {
		expect(decode(assetUrl("shot.png", "/docs/release#1/guide.md")).path).toBe(
			"/docs/release#1/shot.png",
		);
		expect(decode(assetUrl("shot.png", "/docs/what?/guide.md")).path).toBe("/docs/what?/shot.png");
	});

	it("decodes an already-encoded relative path once, keeps a fragment and drops a query", () => {
		expect(decode(assetUrl("a%23b.png", "/docs/guide.md")).path).toBe("/docs/a#b.png");
		expect(decode(assetUrl("my%20shot.svg?raw#top", "/docs/guide.md"))).toEqual({
			path: "/docs/my shot.svg",
			hash: "#top",
		});
		expect(decode(assetUrl("bad%zz.png", "/docs/guide.md")).path).toBe("/docs/bad%zz.png");
	});

	it("leaves the path as written when the document path is not absolute", () => {
		expect(assetUrl("./a.png", "guide.md")).toBe("./a.png");
	});
});

describe("getAssetUrl", () => {
	it("round-trips any absolute path through the query", () => {
		fc.assert(
			fc.property(fc.array(fc.string({ minLength: 1 }), { maxLength: 5 }), (segments) => {
				const abs = `/${segments.join("/")}`;
				expect(decode(getAssetUrl(abs)).path).toBe(abs);
			}),
		);
	});
});
