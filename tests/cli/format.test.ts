import { describe, expect, it } from "vitest";
import {
	NO_ROOTS_MESSAGE,
	NO_SERVER_MESSAGE,
	formatDiagnostic,
	formatDocTree,
	formatRoots,
	formatSearchResults,
	formatValidationResult,
	renderStatusLine,
} from "../../src/cli/format.js";
import type { ValidationResult } from "../../src/validation/validate.js";

const base: ValidationResult = {
	ok: true,
	path: "/docs/a.md",
	diagnostics: [],
	rendered: false,
	hints: [],
};

describe("formatValidationResult hints", () => {
	it("prints nothing extra when there are no hints", () => {
		expect(formatValidationResult(base)).not.toContain("hint:");
	});

	it("prints each hint as a `hint:` line after the render status, on an OK result", () => {
		const lines = formatValidationResult({ ...base, hints: ["first", "second"] }).split("\n");
		expect(lines[0]).toBe("OK: /docs/a.md");
		expect(lines.slice(-2)).toEqual(["hint: first", "hint: second"]);
	});

	it("keeps hints after the diagnostics on a failing result", () => {
		const lines = formatValidationResult({
			...base,
			ok: false,
			diagnostics: [{ severity: "error", code: "mdx-compile", message: "boom", line: 3 }],
			hints: ["use Screenshot"],
		}).split("\n");
		expect(lines[0]).toContain("boom");
		expect(lines[lines.length - 1]).toBe("hint: use Screenshot");
	});
});

describe("renderStatusLine", () => {
	it("reports a clean render", () => {
		expect(renderStatusLine({ ...base, rendered: true })).toBe("Rendered OK");
	});

	it("reports a render with errors", () => {
		expect(renderStatusLine({ ...base, rendered: true, ok: false })).toBe("Rendered with errors");
	});

	it("blames the errors, not the server, when static errors stopped the render", () => {
		const status = renderStatusLine({
			...base,
			ok: false,
			diagnostics: [{ severity: "error", code: "mdx-compile", message: "boom" }],
		});
		expect(status).toBe("Not rendered (fix the errors above first)");
	});

	it("says no server is reachable otherwise", () => {
		const status = renderStatusLine(base);
		expect(status).toBe(
			"Not rendered (no mdxserve server is reachable; start one with `mdxserve serve -w <dir>`)",
		);
	});
});

describe("messages", () => {
	it("points readers to the available server and roots commands", () => {
		expect(NO_ROOTS_MESSAGE).toContain("mdxserve roots add <dir>");
		expect(NO_SERVER_MESSAGE).toContain("mdxserve serve");
	});
});

describe("formatters", () => {
	it("formatDiagnostic appends suggestions", () => {
		const text = formatDiagnostic("/a.mdx", {
			severity: "error",
			code: "unknown-component",
			message: "nope",
			line: 2,
			column: 1,
			suggestions: ["Callout", "Badge"],
		});
		expect(text).toBe(
			"/a.mdx:2:1  error  unknown-component  nope\n    did you mean: Callout, Badge",
		);
	});

	it("formatSearchResults handles zero and some hits", () => {
		expect(formatSearchResults("x", [])).toBe('No docs match "x".');
		const text = formatSearchResults("x", [
			{ path: "/a.md", label: "a.md", title: "A", excerpt: "about x", terms: ["x"], score: 1 },
		]);
		expect(text).toBe("/a.md — A\n    about x");
	});

	it("formatDocTree indents nodes and marks empty roots, preferring the header dir", () => {
		const text = formatDocTree(
			[
				{
					name: "docs",
					dir: "/docs",
					nodes: [
						{ name: "sub", isDir: true, path: "/docs/sub", children: [] },
						{ name: "a.md", isDir: false, path: "/docs/a.md" },
					],
				},
				{ name: "empty", dir: "/empty", nodes: [] },
			] as never,
			null,
		);
		expect(text).toBe("docs (/docs)\n  sub/\n  a.md\n\nempty (/empty)\n  (no docs)");
		expect(formatDocTree([{ name: "docs", dir: "/docs", nodes: [] }], "/x")).toContain("docs (/x)");
	});

	it("formatRoots lists name and dir, or says none are served", () => {
		expect(formatRoots([])).toBe("(no folders served)");
		expect(formatRoots([{ name: "docs", dir: "/docs" }])).toBe("docs  /docs");
	});
});
