import { describe, expect, it } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { Uniwind } from "uniwind";
import "../src/global.css";
import type { BlockNode, InlineNode } from "@mdxserve/client/document/tree-types";
import { BlockStateStorageContext } from "@mdxserve/ui/block-state/useBlockState";
import { createMemoryBlockStorage } from "@mdxserve/ui/block-state/storage";
import { DocumentEnvironmentProvider } from "@mdxserve/ui/document/environment";
import { NodeList } from "@mdxserve/ui/document/nodes";
import { appDocumentEnvironment } from "../src/document-environment";
import { loadCompiledStylesheet, resolveTheme } from "./stylesheet/analyze.js";

// The app's table grid laid out like an HTML table: one width per column, shared by the header
// and every row, wrapping text, the column's alignment, and one sideways scroller. jest has no
// layout engine, so the tests read the widths and styles the grid sets.

const sheet = loadCompiledStylesheet();

const text = (value: string): InlineNode => ({ type: "text", value });
const code = (value: string): InlineNode => ({ type: "inlineCode", value });

/** A comparison like the one in docs/brainstorms/nativecodehighlighting.md: 12 rows, 5 columns. */
const COMPARISON: BlockNode = {
	type: "table",
	id: "comparison",
	persist: false,
	align: [null, null, null, null, null],
	head: [
		[text("Question")],
		[text("A. Shiki in the app")],
		[text("B. Prism (refractor)")],
		[text("C. Server tokens")],
		[text("D. No colours")],
	],
	rows: [
		[
			[text("Runs on Hermes")],
			[text("Yes with a "), code("String.prototype.matchAll"), text(" polyfill")],
			[text("Yes")],
			[text("Not applicable")],
			[text("Yes")],
		],
		[
			[text("iOS bundle (base 5,546,809 B)")],
			[text("+522,909 B (TS only); +2,737,031 B (all grammars)")],
			[text("+95,412 B")],
			[text("unchanged")],
			[text("unchanged")],
		],
		...Array.from({ length: 10 }, (_, index) => [
			[text(`Measurement ${index + 1}`)],
			[text(`${251 + index} ms / ${48 + index} ms`)],
			[text("5.5 MB allocated (1.3 MB before), 12.6 MB peak")],
			[{ type: "strong", children: [text("0")] } as InlineNode],
			[text("Unchanged (nested "), code("Text"), text(", same offsets)")],
		]),
	],
};

const NARROW: BlockNode = {
	type: "table",
	id: "narrow",
	persist: false,
	align: [null, "center", "right"],
	head: [[text("Name")], [text("State")], [text("Count")]],
	rows: [
		[[text("Alpha")], [text("on")], [text("1")]],
		[[text("Beta")], [text("off")], [text("22")]],
	],
};

function renderTable(node: BlockNode) {
	return render(
		<BlockStateStorageContext value={createMemoryBlockStorage()}>
			<DocumentEnvironmentProvider value={appDocumentEnvironment}>
				<NodeList nodes={[node]} />
			</DocumentEnvironmentProvider>
		</BlockStateStorageContext>,
	);
}

const styleOf = (testID: string) =>
	StyleSheet.flatten(screen.getByTestId(testID).props.style) as Record<string, unknown>;

/** Each column's [x, width] in a row of the grid: the sum of the widths before it, and its own. */
function columnBoxes(id: string, row: "header" | number, columns: number): [number, number][] {
	let x = 0;
	return Array.from({ length: columns }, (_, column) => {
		const width = styleOf(
			row === "header"
				? `data-table-${id}-header-${column}`
				: `data-table-${id}-cell-${row}-${column}`,
		).width as number;
		const box: [number, number] = [x, width];
		x += width;
		return box;
	});
}

/** The paragraph a cell's text sits in: the outermost text inside the cell. */
function paragraphStyle(testID: string): Record<string, unknown> {
	const cell = screen.getByTestId(testID);
	const queue = [...cell.children];
	while (queue.length) {
		const child = queue.shift();
		if (!child || typeof child === "string") continue;
		if (child.type === "Text") return StyleSheet.flatten(child.props.style) ?? {};
		queue.push(...child.children);
	}
	throw new Error(`no text in ${testID}`);
}

async function layOut(id: string, width: number) {
	await act(async () =>
		fireEvent(screen.getByTestId(`data-table-${id}-scroll`), "layout", {
			nativeEvent: { layout: { x: 0, y: 0, width, height: 400 } },
		}),
	);
}

describe.each(["light", "dark"] as const)("the app's table grid (%s)", (theme) => {
	const { variables } = resolveTheme(sheet, theme);

	it("gives every cell of a column the header's x and width, and scrolls a wide table", async () => {
		await act(async () => Uniwind.setTheme(theme));
		await renderTable(COMPARISON);
		await layOut("comparison", 360);

		const header = columnBoxes("comparison", "header", 5);
		for (let row = 0; row < 12; row++) expect(columnBoxes("comparison", row, 5)).toEqual(header);
		for (const [, width] of header) {
			expect(width).toBeGreaterThanOrEqual(72);
			expect(width).toBeLessThanOrEqual(320);
		}
		// The column of long text is capped and wraps; the longest code word still fits.
		expect(header[2][1]).toBe(240);
		expect(header[1][1]).toBeGreaterThanOrEqual("String.prototype.matchAll".length * 7.5 + 32);

		const total = header.reduce((sum, [, width]) => sum + width, 0);
		expect(total).toBeGreaterThan(360);
		const scroll = screen.getByTestId("data-table-comparison-scroll");
		expect(scroll.props.horizontal).toBe(true);
		expect(scroll.props.scrollEnabled).toBe(true);
		expect(scroll.props.showsHorizontalScrollIndicator).toBe(true);
		// Opens at the first column; no safe-area inset may shift it.
		expect(scroll.props.contentOffset).toEqual({ x: 0, y: 0 });
		expect(scroll.props.automaticallyAdjustContentInsets).toBe(false);

		// Rows size to their tallest cell: no cell has a fixed height or a line limit.
		const cell = styleOf("data-table-comparison-cell-0-1");
		expect(cell.height).toBeUndefined();
		expect(cell.minHeight).toBe(49);
		expect(screen.getByText("String.prototype.matchAll")).toBeOnTheScreen();
		for (const label of screen.getAllByText(/ms \/ /))
			expect(label.props.numberOfLines).toBeUndefined();

		// Text columns read left; the theme's body colour reaches inline runs.
		expect(paragraphStyle("data-table-comparison-cell-0-1").textAlign).toBe("left");
		expect(StyleSheet.flatten(screen.getByText("Runs on Hermes").props.style).color).toBe(
			variables["--text-body"],
		);
	});

	it("shares spare width among the columns of a narrow table and aligns them as the alignment row says", async () => {
		await act(async () => Uniwind.setTheme(theme));
		await renderTable(NARROW);
		// Hidden until it knows its width, so its columns never visibly grow.
		expect(styleOf("data-table-narrow-scroll").opacity).toBe(0);
		await layOut("narrow", 600);
		expect(styleOf("data-table-narrow-scroll").opacity).toBeUndefined();

		const header = columnBoxes("narrow", "header", 3);
		expect(header.reduce((sum, [, width]) => sum + width, 0)).toBe(600);
		for (const row of [0, 1]) expect(columnBoxes("narrow", row, 3)).toEqual(header);
		expect(screen.getByTestId("data-table-narrow-scroll").props.scrollEnabled).toBe(false);

		expect(
			["left", "center", "right"].map(
				(_, column) => paragraphStyle(`data-table-narrow-cell-0-${column}`).textAlign,
			),
		).toEqual(["left", "center", "right"]);
		expect(
			[0, 1, 2].map((column) => styleOf(`data-table-narrow-header-${column}`).justifyContent),
		).toEqual(["flex-start", "center", "flex-end"]);
	});
});
