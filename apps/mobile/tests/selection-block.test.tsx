import { describe, expect, it, jest } from "@jest/globals";
import { act, render, screen } from "@testing-library/react-native";
import { Alert, processColor, StyleSheet } from "react-native";
import { Uniwind } from "uniwind";
import "../src/global.css";
import {
	captureAnchor,
	mapNormalizedRange,
	resolveAnchor,
	type AnchorFields,
} from "@mdxserve/client/comments/anchor";
import { marksOf } from "@mdxserve/client/comments/marks";
import { collectTreeBlocks } from "@mdxserve/client/comments/tree-blocks";
import type { DocumentTree, TreeNode } from "@mdxserve/client/document/tree-types";
import { CommentMarksContext, type CommentMarks } from "@mdxserve/ui/document/comment-marks";
import { DocumentEnvironmentProvider } from "@mdxserve/ui/document/environment";
import { NodeList } from "@mdxserve/ui/document/nodes";
import { SelectableBlockContext } from "@mdxserve/ui/document/text-runs";
import type { NativeTextRun } from "../modules/selectable-text";
import { appDocumentEnvironment } from "../src/document-environment";
import { DocumentSelectionContext, selectableBlock } from "../src/selection/SelectableBlock";
import { loadCompiledStylesheet, resolveTheme } from "./stylesheet/analyze.js";

// The development build's native view, as a host element the test reads the props of.
jest.mock("../modules/selectable-text", () => {
	const { createElement } = jest.requireActual<typeof import("react")>("react");
	return {
		SelectableTextView: (props: object) => createElement("SelectableTextView", props),
	};
});

const sheet = loadCompiledStylesheet();

const text = (value: string) => ({ type: "text", value });
const paragraph = (...children: unknown[]) => ({ type: "paragraph", children });

function document(): DocumentTree {
	return {
		schemaVersion: 1,
		metadata: { openGraph: [] },
		toc: [],
		children: [
			{
				type: "section",
				id: "guide",
				level: 2,
				heading: [text("Guide")],
				children: [
					paragraph(
						text("The reader opens\na document and "),
						{ type: "strong", children: [text("bold words")] },
						text(" then "),
						{ type: "link", href: "https://example.com/", title: null, children: [text("a link")] },
						text(" with "),
						{ type: "inlineCode", value: "chip" },
						text("."),
					),
					paragraph(text("A picture "), { type: "image", src: "/a.png", alt: "a", title: null }),
					{
						type: "list",
						ordered: false,
						start: null,
						items: [{ checked: null, children: [paragraph(text("A tight item"))] }],
					},
					{ type: "blockquote", children: [paragraph(text("Quoted words"))] },
				],
			},
		],
	} as unknown as DocumentTree;
}

interface Host {
	type: string;
	props: Record<string, any>;
	children: (Host | string)[] | null;
}

function hosts(tree: unknown): Host[] {
	if (!tree || typeof tree !== "object") return [];
	if (Array.isArray(tree)) return tree.flatMap(hosts);
	const host = tree as Host;
	return [host, ...hosts(host.children ?? [])];
}

function views(): Host[] {
	return hosts(screen.toJSON()).filter((host) => host.type === "SelectableTextView");
}

function joined(view: Host): string {
	return (view.props.runs as NativeTextRun[]).map((run) => run.text).join("");
}

function viewWith(prefix: string): Host {
	const found = views().find((view) => joined(view).startsWith(prefix));
	if (!found) throw new Error(`No selectable text starting "${prefix}"`);
	return found;
}

function marksFor(tree: DocumentTree, quotes: Record<string, string>, active: string | null) {
	const blocks = collectTreeBlocks(tree);
	const resolutions = new Map(
		Object.entries(quotes).map(([id, quote]) => {
			const block = blocks.blocks.findIndex((candidate) => candidate.text.includes(quote));
			const start = blocks.blocks[block].text.indexOf(quote);
			const range = mapNormalizedRange(blocks.blocks[block].nodes, start, start + quote.length)!;
			const anchor = captureAnchor(blocks.descriptions, { blockIndex: block, ...range })!;
			return [id, resolveAnchor(anchor, blocks.index)];
		}),
	);
	const marks = marksOf(blocks, resolutions);
	const pressMark = jest.fn();
	const store: CommentMarks = {
		subscribe: () => () => {},
		marksOf: (source) => marks.get(source),
		activeThread: () => active,
		pressMark,
	};
	return { store, pressMark };
}

async function draw(
	tree: DocumentTree,
	{
		selectable = selectableBlock,
		startThread = jest.fn<(anchor: AnchorFields) => void>(),
		marks = null,
		openLink = jest.fn(),
	}: {
		selectable?: typeof selectableBlock;
		startThread?: ((anchor: AnchorFields) => void) | null;
		marks?: CommentMarks | null;
		openLink?: (href: string) => void;
	} = {},
) {
	await render(
		<DocumentEnvironmentProvider value={{ ...appDocumentEnvironment, openLink }}>
			<CommentMarksContext value={marks}>
				<DocumentSelectionContext value={{ blocks: collectTreeBlocks(tree), startThread }}>
					<SelectableBlockContext value={selectable}>
						<NodeList nodes={tree.children as TreeNode[]} />
					</SelectableBlockContext>
				</DocumentSelectionContext>
			</CommentMarksContext>
		</DocumentEnvironmentProvider>,
	);
	return { startThread, openLink };
}

describe.each(["light", "dark"] as const)("selectable text (%s)", (theme) => {
	const { variables } = resolveTheme(sheet, theme);
	const color = (name: string) => processColor(variables[name] as string);

	it("draws a heading, a paragraph, a tight item and a quoted paragraph as selectable text", async () => {
		Uniwind.setTheme(theme);
		await draw(document());
		expect(views().map(joined)).toEqual([
			"Guide",
			"The reader opens a document and bold words then a link with chip.",
			"A tight item",
			"Quoted words",
		]);
		expect(viewWith("Guide").props.heading).toBe(true);
		expect(viewWith("The reader").props.heading).toBe(false);
		// The block holding an image keeps its Text.
		expect(screen.getByText("A picture")).toBeOnTheScreen();
	});

	it("passes the prose's line height and the theme's colours, and lays the same runs out under it", async () => {
		Uniwind.setTheme(theme);
		await draw(document());
		const view = viewWith("The reader");
		expect(view.props.lineHeight).toBeCloseTo(16.5 * 1.72, 1);
		expect(view.props.commentTitle).toBe("Comment");
		const runs = view.props.runs as NativeTextRun[];
		const run = (value: string) => runs.find((candidate) => candidate.text === value)!;
		expect(run("The reader opens a document and ")).toMatchObject({
			fontFamily: "Manrope",
			fontSize: 16.5,
			color: color("--text-body"),
			backgroundColor: null,
		});
		expect(run("bold words")).toMatchObject({ fontWeight: 600, color: color("--text-heading") });
		expect(run("a link")).toMatchObject({ color: color("--text-link"), pressable: true });
		expect(run("chi")).toMatchObject({
			fontFamily: "JetBrains Mono",
			fontSize: 13,
			color: color("--text-accent"),
			backgroundColor: color("--code-bg-inline"),
			rounded: true,
		});
		// The invisible Text under the view holds the same runs, in the same faces.
		const twin = screen.getByText("bold words", { includeHiddenElements: true });
		expect(StyleSheet.flatten(twin.props.style)).toMatchObject({
			fontFamily: "Manrope",
			fontWeight: "600",
			fontSize: 16.5,
		});
		expect(StyleSheet.flatten(twin.parent?.props.style as never)).toMatchObject({ opacity: 0 });
	});

	it("draws highlights and the active one with the mark tokens, and their taps open the thread", async () => {
		Uniwind.setTheme(theme);
		const tree = document();
		const { store, pressMark } = marksFor(tree, { one: "bold words", two: "Quoted" }, "two");
		await draw(tree, { marks: store });
		const runs = viewWith("The reader").props.runs as NativeTextRun[];
		const bold = runs.findIndex((run) => run.text === "bold words");
		expect(runs[bold].backgroundColor).toBe(color("--comment-mark"));
		expect((viewWith("Quoted").props.runs as NativeTextRun[])[0].backgroundColor).toBe(
			color("--comment-mark-active"),
		);
		await act(async () =>
			viewWith("The reader").props.onPressRun({ nativeEvent: { index: bold } }),
		);
		expect(pressMark).toHaveBeenCalledWith(["one"]);
	});
});

describe("selectable text's events", () => {
	it("starts a thread on the selected words", async () => {
		const { startThread } = await draw(document());
		const view = viewWith("The reader");
		const all = joined(view);
		const start = all.indexOf("document");
		const end = all.indexOf("a link") + 6;
		await act(async () =>
			view.props.onComment({ nativeEvent: { start, end, text: all.slice(start, end) } }),
		);
		expect(startThread).toHaveBeenCalledWith({
			heading: "Guide",
			block: "The reader opens a document and bold words then a link with chip.",
			quote: "document and bold words then a link",
		});
	});

	it("says so when a selection cannot be matched to the block", async () => {
		const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
		const { startThread } = await draw(document());
		await act(async () =>
			viewWith("The reader").props.onComment({
				nativeEvent: { start: 0, end: 3, text: "not in it" },
			}),
		);
		expect(startThread).not.toHaveBeenCalled();
		expect(alert).toHaveBeenCalledWith("This selection could not be turned into a comment.");
		alert.mockRestore();
	});

	it("opens a link through the document's link handler", async () => {
		const { openLink } = await draw(document());
		const view = viewWith("The reader");
		const index = (view.props.runs as NativeTextRun[]).findIndex((run) => run.text === "a link");
		// VoiceOver reaches the link through an action, since it cannot tap the run.
		expect(view.props.actions).toEqual([{ name: "Open link: a link", index }]);
		await act(async () => view.props.onPressRun({ nativeEvent: { index } }));
		expect(openLink).toHaveBeenCalledWith("https://example.com/");
	});

	it("offers no Comment where the reader may not write, and selection still copies", async () => {
		await draw(document(), { startThread: null });
		expect(views()).toHaveLength(4);
		for (const view of views()) expect(view.props.commentTitle).toBeUndefined();
	});

	it("grows the block when the native text needs more room than the Text layout took", async () => {
		await draw(document());
		const block = screen.getAllByTestId("selectable-block")[1];
		await act(async () => {
			screen.getByText("bold words", { includeHiddenElements: true }).parent?.props.onLayout({
				nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 56 } },
			});
		});
		await act(async () =>
			viewWith("The reader").props.onTextHeight({ nativeEvent: { height: 56.4 } }),
		);
		expect(StyleSheet.flatten(block.props.style).minHeight).toBeUndefined();
		await act(async () =>
			viewWith("The reader").props.onTextHeight({ nativeEvent: { height: 84 } }),
		);
		expect(StyleSheet.flatten(block.props.style)).toMatchObject({
			minHeight: 84,
			marginVertical: 8,
		});
	});

	it("draws every block with Text where the module is absent, as in Expo Go", async () => {
		await draw(document(), { selectable: null });
		expect(views()).toHaveLength(0);
		expect(screen.getByText("Quoted words")).toBeOnTheScreen();
	});
});
