import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { Uniwind } from "uniwind";
import "../src/global.css";
import {
	captureAnchor,
	mapNormalizedRange,
	resolveAnchor,
	type Resolution,
} from "@mdxserve/client/comments/anchor";
import { marksOf } from "@mdxserve/client/comments/marks";
import { collectTreeBlocks } from "@mdxserve/client/comments/tree-blocks";
import type { DocumentTree, TreeNode } from "@mdxserve/client/document/tree-types";
import { CommentMarksContext, type CommentMarks } from "@mdxserve/ui/document/comment-marks";
import { DocumentEnvironmentProvider } from "@mdxserve/ui/document/environment";
import { NodeList } from "@mdxserve/ui/document/nodes";
import { appDocumentEnvironment } from "../src/document-environment";
import { documentRows } from "../src/document/rows";
import { loadCompiledStylesheet, resolveTheme } from "./stylesheet/analyze.js";
import markdownTour from "./fixtures/01-markdown.md.json";
import builtins from "./fixtures/06-builtins.mdx.json";
import readme from "./fixtures/README.md.json";

const sheet = loadCompiledStylesheet();

const text = (value: string) => ({ type: "text", value });
const code = (value: string) => ({ type: "inlineCode", value });
const paragraph = (...children: unknown[]) => ({ type: "paragraph", children });

/** One paragraph with a soft line break, bold, a link, a short code chip and long code. */
function document(): DocumentTree {
	return {
		schemaVersion: 1,
		metadata: { openGraph: [] },
		toc: [],
		children: [
			paragraph(
				text("The reader opens\na document and "),
				{ type: "strong", children: [text("bold words")] },
				text(" then "),
				{ type: "link", href: "https://example.com/", title: null, children: [text("a link")] },
				text(" with "),
				code("chip"),
				text(" and "),
				code("a long piece of code"),
				text(" at the end."),
			),
		],
	} as unknown as DocumentTree;
}

interface Host {
	type: string;
	props: { style?: unknown; onPress?: unknown };
	children: (Host | string)[] | null;
}

function flat(host: { props: { style?: unknown } }): Record<string, unknown> {
	return StyleSheet.flatten(host.props.style as never) ?? {};
}

function hosts(tree: unknown): Host[] {
	if (!tree || typeof tree !== "object") return [];
	if (Array.isArray(tree)) return tree.flatMap(hosts);
	const host = tree as Host;
	return [host, ...hosts(host.children ?? [])];
}

function shownText(tree: unknown): string {
	if (typeof tree === "string") return tree;
	if (!tree || typeof tree !== "object") return "";
	if (Array.isArray(tree)) return tree.map(shownText).join("");
	return shownText((tree as Host).children ?? []);
}

/** The anchor for characters [start, end) of the document's first block, and where it resolves. */
function threadOn(tree: DocumentTree, quote: string): Resolution {
	const blocks = collectTreeBlocks(tree);
	const start = blocks.blocks[0].text.indexOf(quote);
	const range = mapNormalizedRange(blocks.blocks[0].nodes, start, start + quote.length);
	const anchor = range && captureAnchor(blocks.descriptions, { blockIndex: 0, ...range });
	if (!anchor) throw new Error(`No anchor for ${quote}`);
	return resolveAnchor(anchor, blocks.index);
}

/** A fixed set of marks, as the document screen's store hands them to the text. */
function marksFor(
	tree: DocumentTree,
	threads: Record<string, string>,
	active: string | null,
	pressMark: (ids: readonly string[]) => void = () => {},
): CommentMarks {
	const resolutions = new Map(
		Object.entries(threads).map(([id, quote]) => [id, threadOn(tree, quote)] as const),
	);
	const marks = marksOf(collectTreeBlocks(tree), resolutions);
	return {
		subscribe: () => () => {},
		marksOf: (source) => marks.get(source),
		activeThread: () => active,
		pressMark,
	};
}

async function draw(tree: DocumentTree, marks: CommentMarks | null, openLink = () => {}) {
	return render(
		<DocumentEnvironmentProvider value={{ ...appDocumentEnvironment, openLink }}>
			<CommentMarksContext value={marks}>
				<NodeList nodes={tree.children as TreeNode[]} />
			</CommentMarksContext>
		</DocumentEnvironmentProvider>,
	);
}

describe.each(["light", "dark"] as const)("comment highlights in the app (%s)", (theme) => {
	const { variables } = resolveTheme(sheet, theme);

	it("gives the quoted words the mark's background and leaves the text as it was", async () => {
		Uniwind.setTheme(theme);
		const tree = document();
		const plain = shownText((await draw(tree, null)).toJSON());
		await screen.unmount();
		const { toJSON } = await draw(tree, marksFor(tree, { t1: "opens a document" }, null));
		expect(shownText(toJSON())).toBe(plain);
		expect(plain).toContain("The reader opens a document and bold words");
		// The soft line break is a space, in the highlight as everywhere else.
		const mark = screen.getByText("opens a document");
		expect(flat(mark).backgroundColor).toBe(variables["--comment-mark"]);
		expect(variables["--comment-mark"]).toBe(variables["--status-warn-bg"]);
	});

	it("gives the active thread's words the active colour", async () => {
		Uniwind.setTheme(theme);
		const tree = document();
		await draw(tree, marksFor(tree, { t1: "bold words", t2: "the end" }, "t1"));
		expect(flat(screen.getByText("bold words")).backgroundColor).toBe(
			variables["--comment-mark-active"],
		);
		expect(flat(screen.getByText("the end")).backgroundColor).toBe(variables["--comment-mark"]);
		expect(variables["--comment-mark-active"]).toMatch(/^#[0-9a-f]{6}$/);
	});

	it("colours a code chip the quote covers, and long code's marked words", async () => {
		Uniwind.setTheme(theme);
		const tree = document();
		await draw(tree, marksFor(tree, { t1: "with chip and a long" }, null));
		const chip = screen.getByText("chip");
		expect(flat(chip.parent as never).backgroundColor).toBe(variables["--comment-mark"]);
		expect(flat(screen.getByText("a long")).backgroundColor).toBe(variables["--comment-mark"]);
		// Inside the code's own run, so it keeps the code's font.
		expect(flat(screen.getByText("a long").parent as never).fontFamily).toBe("JetBrains Mono");
	});

	it("keeps a thread on part of a chip that another thread covers whole", async () => {
		Uniwind.setTheme(theme);
		const tree = document();
		const pressMark = jest.fn();
		await draw(tree, marksFor(tree, { whole: "chip", part: "hi" }, "part", pressMark));
		const part = screen.getByText("hi");
		expect(flat(part).backgroundColor).toBe(variables["--comment-mark-active"]);
		await fireEvent.press(part);
		expect(pressMark).toHaveBeenCalledWith(["whole", "part"]);
		// The rest of the chip is the whole-chip thread's.
		expect(flat(screen.getByText("p")).backgroundColor).toBe(variables["--comment-mark"]);
	});

	it("opens a thread from its highlight, and leaves a link's press to the link", async () => {
		Uniwind.setTheme(theme);
		const tree = document();
		const pressMark = jest.fn();
		const openLink = jest.fn();
		await draw(tree, marksFor(tree, { t1: "bold words", t2: "a link" }, null, pressMark), openLink);
		await fireEvent.press(screen.getByText("bold words"));
		expect(pressMark).toHaveBeenCalledWith(["t1"]);
		await fireEvent.press(screen.getByText("a link"));
		expect(openLink).toHaveBeenCalledWith("https://example.com/");
		expect(pressMark).toHaveBeenCalledTimes(1);
	});

	it("never puts a string straight into a view", async () => {
		Uniwind.setTheme(theme);
		const tree = document();
		const { toJSON } = await draw(
			tree,
			marksFor(tree, { t1: "reader opens", t2: "opens a document and bold" }, "t2"),
		);
		for (const host of hosts(toJSON()))
			if (host.type === "View")
				for (const child of host.children ?? []) expect(typeof child).not.toBe("string");
	});
});

describe("the rows of the example documents", () => {
	it("draw every block a comment can sit on", () => {
		for (const fixture of [markdownTour, builtins, readme]) {
			const tree = (fixture as unknown as { document: DocumentTree }).document;
			const rows = documentRows(tree);
			const blocks = collectTreeBlocks(tree).blocks;
			expect(blocks.length).toBeGreaterThan(5);
			for (const block of blocks) expect(rows.rowOfNode.get(block.container)).toBeDefined();
		}
	});
});
