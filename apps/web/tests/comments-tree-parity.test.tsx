// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentService } from "@karimsa/mdxserve/src/document/service";
import type { DocumentTree } from "@karimsa/mdxserve/src/document/schema";
import { builtinRegistry } from "@karimsa/mdxserve/tests/helpers/components";
import { captureAnchor, mapNormalizedRange, resolveAnchor } from "@mdxserve/client/comments/anchor";
import { collectTreeBlocks } from "@mdxserve/client/comments/tree-blocks";
import { queryClient, trpc } from "../src/api";
import { captureSelection, collectDoc, resolveInDom, resolveIndexOf } from "../src/comments/dom";
import { DocumentView } from "../src/document/DocumentView";

vi.mock("../src/Mermaid", () => ({ MermaidDiagram: () => null }));

const REPO = resolve(__dirname, "../../..");

/** The documents both clients' tests use (the app's are apps/mobile/tests/fixtures/*.json). */
const DOCUMENTS = ["example/01-markdown.md", "README.md", "example/06-builtins.mdx"];

function parse(source: string, path: string): DocumentTree {
	return new DocumentService(builtinRegistry, (relative) => relative).parse(source, path).tree;
}

const REDUCED_MOTION_NOTICE = "You have Reduced Motion enabled on your device.";
const consoleWarn = console.warn;
beforeAll(() => {
	vi.spyOn(console, "warn").mockImplementation((message?: unknown, ...rest: unknown[]) => {
		if (typeof message === "string" && message.startsWith(REDUCED_MOTION_NOTICE)) return;
		consoleWarn(message, ...rest);
	});
});
afterAll(() => vi.mocked(console.warn).mockRestore());

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal("matchMedia", () => ({
		matches: true,
		addEventListener() {},
		removeEventListener() {},
	}));
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	queryClient.clear();
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
});

afterEach(async () => {
	await act(async () => root.unmount());
	host.remove();
	queryClient.clear();
	vi.unstubAllGlobals();
});

async function renderArticle(tree: DocumentTree, path: string): Promise<Element> {
	queryClient.setQueryData(trpc.getDocument.queryKey({ path }), { document: tree, version: "v" });
	await act(async () =>
		root.render(
			createElement(
				QueryClientProvider,
				{ client: queryClient },
				createElement(DocumentView, { path }),
			),
		),
	);
	const article = host.querySelector("article.mdx-prose");
	if (!article) throw new Error("No article");
	return article;
}

interface Entry {
	text: string;
	heading: string | null;
}

/** Each document under its own extension and the other one: `.md` and `.mdx` must agree. */
const CASES = DOCUMENTS.flatMap((file) => {
	const other = file.endsWith(".mdx")
		? file.replace(/\.mdx$/, ".md")
		: file.replace(/\.md$/, ".mdx");
	return [
		{ file, path: `/repo/${file}` },
		{ file, path: `/repo/${other}` },
	];
});

/** For each of `wanted`, its index in `all`, matching in order; null when it is not a subsequence. */
function alignment(wanted: readonly Entry[], all: readonly Entry[]): number[] | null {
	const found: number[] = [];
	let next = 0;
	for (const entry of wanted) {
		while (
			next < all.length &&
			(all[next].text !== entry.text || all[next].heading !== entry.heading)
		)
			next++;
		if (next === all.length) return null;
		found.push(next++);
	}
	return found;
}

function select(start: { node: Text; offset: number }, end: { node: Text; offset: number }) {
	const range = document.createRange();
	range.setStart(start.node, start.offset);
	range.setEnd(end.node, end.offset);
	const selection = window.getSelection() as Selection;
	selection.removeAllRanges();
	selection.addRange(range);
	return selection;
}

describe.each(CASES)("comment blocks from the tree, for $path", ({ file, path }) => {
	const source = readFileSync(resolve(REPO, file), "utf8");

	async function both() {
		const tree = parse(source, path);
		const article = await renderArticle(tree, path);
		const doc = collectDoc(article);
		const treeBlocks = collectTreeBlocks(tree);
		const dom: Entry[] = doc.blocks.map((block) => ({
			text: block.text,
			heading: block.section === -1 ? null : doc.headings[block.section].key,
		}));
		const app: Entry[] = treeBlocks.blocks.map((block) => ({
			text: block.text,
			heading: block.section === -1 ? null : treeBlocks.index.headings[block.section].key,
		}));
		return { tree, article, doc, treeBlocks, dom, app };
	}

	it("are the web's blocks, in order, with the same text and heading", async () => {
		const { dom, app } = await both();
		expect(app.length).toBeGreaterThan(10);
		// Exclusions, each named:
		// - The web lists the footnotes after the document under a generated "Footnotes" heading;
		//   the app draws them outside the document's rows and anchors nothing there.
		// - Builtins that draw text from their props (a Callout's title, a Card's body, a Diff's
		//   lines, a Screenshot's caption) are blocks on the web and have no text in the tree, so
		//   for the builtins tour the app's list is a subsequence of the web's.
		const footnotes = dom.findIndex((entry) => entry.text === "Footnotes");
		const shown = footnotes === -1 ? dom : dom.slice(0, footnotes);
		if (file.endsWith("06-builtins.mdx")) expect(alignment(app, shown)).not.toBeNull();
		else expect(app).toEqual(shown);
	});

	it("resolves an anchor taken in either client exactly in the other (KA11)", async () => {
		const { article, doc, treeBlocks, dom, app } = await both();
		const positions = alignment(app, dom);
		if (!positions) throw new Error("The tree's blocks are not the web's");
		const domIndex = resolveIndexOf(doc);
		let checked = 0;
		treeBlocks.blocks.forEach((block, blockIndex) => {
			if (block.text === "") return;
			const domBlock = doc.blocks[positions[blockIndex]];
			const third = Math.floor(block.text.length / 3);
			const spans: Array<[number, number]> = [[0, block.text.length]];
			if (third > 0) spans.push([third, block.text.length - third]);
			for (const [start, end] of spans) {
				// Taken from the tree, as the app takes it; found in the DOM, as the web finds it.
				const range = mapNormalizedRange(block.nodes, start, end);
				const fromApp = range && captureAnchor(treeBlocks.descriptions, { blockIndex, ...range });
				if (!fromApp) throw new Error(`No anchor for ${block.text}`);
				const inDom = resolveInDom(doc, domIndex, fromApp);
				expect(inDom.resolution.state, block.text).toBe("exact");
				if (inDom.resolution.state === "exact")
					expect(doc.blocks[inDom.resolution.block].text).toBe(block.text);

				// Taken from a selection in the DOM, as the web takes it; found in the tree.
				const domRange = mapNormalizedRange(
					domBlock.nodes.map((node) => node.data),
					start,
					end,
				);
				if (!domRange) throw new Error(`No DOM range for ${block.text}`);
				const fromWeb = captureSelection(
					select(
						{ node: domBlock.nodes[domRange.start.node], offset: domRange.start.offset },
						{ node: domBlock.nodes[domRange.end.node], offset: domRange.end.offset },
					),
					article,
				);
				if (!fromWeb) throw new Error(`No web anchor for ${block.text}`);
				const inTree = resolveAnchor(fromWeb, treeBlocks.index);
				expect(inTree.state, block.text).toBe("exact");
				if (inTree.state === "exact") expect(treeBlocks.blocks[inTree.block].text).toBe(block.text);
				checked++;
			}
		});
		expect(checked).toBeGreaterThan(10);
		// `captureSelection` reads the whole article on every call.
	}, 60_000);
});
