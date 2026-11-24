import { describe, expect, it } from "vitest";
import { createProcessor } from "@mdx-js/mdx";
import remarkGfm from "remark-gfm";
import {
	anchorDiagnostics,
	collectBlocks,
	normalizeText,
	resolveAnchorStatically,
} from "../../src/comments/anchor.js";
import type { CommentThread } from "../../src/comments/schema.js";

const tree = createProcessor({ format: "md", remarkPlugins: [remarkGfm] }).parse(
	"Intro line.\n\n# Install\n\nRun the *installer* now.\n\n| a | b |\n| - | - |\n| cell one | cell two |\n\n```sh\nnpm  i\n```\n\n## Install\n\nSecond section text.\n",
);
const collected = collectBlocks(tree);

function thread(id: string, anchor: CommentThread["anchor"], resolved = false): CommentThread {
	return { id, anchor, resolved, messages: [{ id: "m", author: "human", body: "x" }] };
}

describe("normalizeText", () => {
	it("collapses whitespace runs and trims", () => {
		expect(normalizeText("  a \n\t b  c ")).toBe("a b c");
		expect(normalizeText(" \n ")).toBe("");
	});
});

describe("resolveAnchorStatically", () => {
	it("resolves each state", () => {
		expect(
			resolveAnchorStatically(collected, {
				heading: "Install",
				block: "Run the installer now.",
				quote: "installer",
			}),
		).toBe("exact");
		expect(
			resolveAnchorStatically(collected, {
				heading: "Install",
				block: "Run the installer now.",
				quote: "missing",
			}),
		).toBe("block");
		expect(
			resolveAnchorStatically(collected, {
				heading: "Install",
				block: "gone entirely",
				quote: "gone",
			}),
		).toBe("section");
		expect(
			resolveAnchorStatically(collected, {
				heading: "Renamed",
				block: "Run the installer now.",
				quote: "x",
			}),
		).toBe("detached");
	});

	it("normalizes a hand-written anchor before comparing", () => {
		expect(
			resolveAnchorStatically(collected, {
				heading: "Install",
				block: "Run  the\ninstaller now.",
				quote: " the\n installer",
			}),
		).toBe("exact");
	});

	it("handles the null heading, table cells, code, and headings as blocks", () => {
		expect(
			resolveAnchorStatically(collected, { heading: null, block: "Intro line.", quote: "Intro" }),
		).toBe("exact");
		expect(
			resolveAnchorStatically(collected, {
				heading: null,
				block: "Run the installer now.",
				quote: "x",
			}),
		).toBe("section");
		expect(
			resolveAnchorStatically(collected, { heading: "Install", block: "cell two", quote: "cell" }),
		).toBe("exact");
		expect(
			resolveAnchorStatically(collected, { heading: "Install", block: "npm i", quote: "npm" }),
		).toBe("exact");
		expect(
			resolveAnchorStatically(collected, {
				heading: "Install",
				block: "Install",
				quote: "Install",
			}),
		).toBe("exact");
	});

	it("searches same-named headings in document order", () => {
		expect(
			resolveAnchorStatically(collected, {
				heading: "Install",
				block: "Second section text.",
				quote: "Second",
			}),
		).toBe("exact");
	});

	it("matches a block suffix", () => {
		expect(
			resolveAnchorStatically(collected, {
				heading: "Install",
				block: "installer now.",
				quote: "installer",
			}),
		).toBe("exact");
	});
});

describe("anchorDiagnostics", () => {
	it("warns only for open threads whose heading or block is missing", () => {
		const diagnostics = anchorDiagnostics(
			tree,
			[
				thread("ok", { heading: "Install", block: "Run the installer now.", quote: "installer" }),
				thread("lost-block", { heading: "Install", block: "gone", quote: "gone" }),
				thread("lost-heading", { heading: "Nope", block: "gone", quote: "gone" }),
				thread("resolved", { heading: "Nope", block: "gone", quote: "gone" }, true),
			],
			new Map([["lost-block", { line: 7, column: 5 }]]),
		);
		expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
			expect.stringContaining("lost-block"),
			expect.stringContaining("lost-heading"),
		]);
		expect(
			diagnostics.every(
				(diagnostic) => diagnostic.severity === "warning" && diagnostic.code === "comment-anchor",
			),
		).toBe(true);
		expect(diagnostics[0]).toMatchObject({ line: 7, column: 5 });
	});
});

describe("headings longer than the stored limit", () => {
	it("matches an anchor holding the browser's truncated heading", () => {
		const long = "word ".repeat(80).trim();
		const longTree = createProcessor({ format: "md", remarkPlugins: [remarkGfm] }).parse(
			`## ${long}\n\nA paragraph under the long heading.\n`,
		);
		const stored = normalizeText(long).slice(0, 300).trimEnd();
		expect(stored.length).toBeLessThan(long.length);
		const state = resolveAnchorStatically(collectBlocks(longTree), {
			heading: stored,
			block: "A paragraph under the long heading.",
			quote: "paragraph",
		});
		expect(state).toBe("exact");
	});
});
