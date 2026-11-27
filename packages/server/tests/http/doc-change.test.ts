import { describe, expect, it } from "vitest";
import { describeDocChange } from "../../src/http/doc-change.js";

const roots = [
	{ name: "docs", dir: "/srv/docs" },
	{ name: "notes", dir: "/srv/notes" },
];

describe("describeDocChange", () => {
	it("names a doc by its root-relative path", () => {
		expect(describeDocChange(roots, "/srv/docs/guides/install.mdx")).toEqual({
			path: "/srv/docs/guides/install.mdx",
			root: "docs",
			rel: "guides/install.mdx",
		});
	});

	it("matches the root the file lives in", () => {
		expect(describeDocChange(roots, "/srv/notes/todo.md")?.root).toBe("notes");
	});

	it("ignores files outside every root", () => {
		expect(describeDocChange(roots, "/srv/other/readme.md")).toBeNull();
		expect(describeDocChange(roots, "/srv/docs-extra/readme.md")).toBeNull();
	});

	it("ignores non-doc files", () => {
		expect(describeDocChange(roots, "/srv/docs/components/Card.tsx")).toBeNull();
		expect(describeDocChange(roots, "/srv/docs/app.css")).toBeNull();
	});

	it("ignores docs under a dotdir or node_modules", () => {
		expect(describeDocChange(roots, "/srv/docs/.git/README.md")).toBeNull();
		expect(describeDocChange(roots, "/srv/docs/node_modules/pkg/README.md")).toBeNull();
		expect(describeDocChange(roots, "/srv/docs/.hidden.md")).toBeNull();
	});

	it("collapses .. segments before matching", () => {
		expect(describeDocChange(roots, "/srv/docs/../notes/todo.md")?.root).toBe("notes");
	});
});
