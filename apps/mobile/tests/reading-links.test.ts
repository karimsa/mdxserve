import { describe, expect, it } from "@jest/globals";
import * as fc from "fast-check";
import { resolveLink } from "../src/document/links";

const DOC = "/srv/example/guide/intro.md";

describe("resolveLink", () => {
	it("opens another document of the folder, with its fragment", () => {
		expect(resolveLink("./setup.mdx#install", DOC)).toEqual({
			kind: "document",
			path: "/srv/example/guide/setup.mdx",
			fragment: "install",
		});
		expect(resolveLink("../README.md", DOC)).toEqual({
			kind: "document",
			path: "/srv/example/README.md",
			fragment: "",
		});
	});

	it("reveals a heading of this document, by fragment or by its own name", () => {
		expect(resolveLink("#lists", DOC)).toEqual({ kind: "here", fragment: "lists" });
		expect(resolveLink("intro.md#a-table", DOC)).toEqual({ kind: "here", fragment: "a-table" });
		expect(resolveLink("#caf%C3%A9", DOC)).toEqual({ kind: "here", fragment: "café" });
	});

	it("starts a path written with a leading slash at the root, and drops a query", () => {
		expect(resolveLink("/01-markdown.md?raw=1", DOC)).toEqual({
			kind: "document",
			path: "/01-markdown.md",
			fragment: "",
		});
	});

	it("decodes percent-escapes in a path", () => {
		expect(resolveLink("./Read%20me.md", DOC)).toMatchObject({
			path: "/srv/example/guide/Read me.md",
		});
	});

	it("opens a folder, and any other file from the server", () => {
		expect(resolveLink("./nested/", DOC)).toEqual({
			kind: "folder",
			path: "/srv/example/guide/nested",
		});
		expect(resolveLink("../assets/logo.png", DOC)).toEqual({
			kind: "file",
			path: "/srv/example/assets/logo.png",
		});
	});

	it("opens web, mail and phone links outside the app, and nothing for another scheme", () => {
		expect(resolveLink("https://example.com/a?b#c", DOC)).toEqual({
			kind: "web",
			url: "https://example.com/a?b#c",
		});
		expect(resolveLink("mailto:me@example.com", DOC)).toEqual({
			kind: "web",
			url: "mailto:me@example.com",
		});
		expect(resolveLink("//example.com/x", DOC)).toEqual({
			kind: "web",
			url: "https://example.com/x",
		});
		expect(resolveLink("javascript:alert(1)", DOC)).toEqual({ kind: "none" });
		expect(resolveLink("", DOC)).toEqual({ kind: "none" });
	});

	it("resolves against a Windows document in its own form", () => {
		expect(resolveLink("..\\notes\\plan.md", "C:\\docs\\guide\\intro.md")).toEqual({
			kind: "document",
			path: "C:\\docs\\notes\\plan.md",
			fragment: "",
		});
		expect(resolveLink("../../../x.md", "C:\\docs\\intro.md")).toMatchObject({ path: "C:\\x.md" });
		expect(resolveLink("\\\\nas\\share\\notes\\other.md", "C:\\docs\\guide\\intro.md")).toEqual({
			kind: "document",
			path: "\\\\nas\\share\\notes\\other.md",
			fragment: "",
		});
	});

	it("never climbs above the root and always gives an absolute path (property)", () => {
		const segment = fc.constantFrom("..", ".", "a", "b c", "d.md", "");
		fc.assert(
			fc.property(fc.array(segment, { maxLength: 8 }), (segments) => {
				const link = resolveLink(segments.join("/"), DOC);
				if (link.kind === "document" || link.kind === "folder" || link.kind === "file") {
					expect(link.path.startsWith("/")).toBe(true);
					expect(link.path.split("/")).not.toContain("..");
				}
			}),
		);
	});
});
