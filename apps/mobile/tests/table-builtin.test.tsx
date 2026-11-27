import { describe, expect, it } from "@jest/globals";
import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { Uniwind } from "uniwind";
import DataTable from "@mdxserve/ui/builtins/DataTable";
import { BlockStateStorageContext } from "@mdxserve/ui/block-state/useBlockState";
import { createMemoryBlockStorage } from "@mdxserve/ui/block-state/storage";
// The app's stylesheet, as its root layout loads it (jest.config.js maps it to the compiled one).
import "../src/global.css";
import { loadCompiledStylesheet, resolveTheme, unusable } from "./stylesheet/analyze.js";
import { classesInSource } from "./stylesheet/source-classes.js";

const sheet = loadCompiledStylesheet();

const COLUMNS = [
	{ key: "name", label: "Name", type: "text" as const },
	{
		key: "notes",
		label: "Notes",
		type: "text" as const,
	},
	{ key: "size", label: "Size", type: "bytes" as const, unit: "B", bars: true },
	{ key: "cost", label: "Cost", type: "currency" as const, currency: "USD" },
];
const LONG_NOTE =
	"A long note that would run far past the edge of a phone screen if its cell did not wrap it";
const ROWS = [
	{ name: "Beta", notes: LONG_NOTE, size: 2048, cost: 12.5 },
	{ name: "Alpha", notes: "Short", size: 1024, cost: 1234.5 },
	{ name: "Gamma", notes: null, size: 4096, cost: 3 },
];

function renderTable() {
	return render(
		<BlockStateStorageContext value={createMemoryBlockStorage()}>
			<DataTable id="costs" caption="Costs" columns={COLUMNS} data={ROWS} />
		</BlockStateStorageContext>,
	);
}

/** The width a cell starts from: its long text wraps inside it rather than widening the grid. */
function cellWidth(text: ReturnType<typeof screen.getByText>): unknown {
	for (let node = text.parent; node; node = node.parent) {
		const basis = StyleSheet.flatten(node.props.style)?.flexBasis;
		if (basis !== undefined) return basis;
	}
	return undefined;
}

/** The text of each row's first cell, top to bottom. */
function firstColumn() {
	return screen
		.getAllByTestId("data-table-costs-row")
		.map((row) => within(row).getAllByText(/.+/)[0].props.children);
}

describe.each(["light", "dark"] as const)("the app's DataTable (%s)", (theme) => {
	const { classes, variables } = resolveTheme(sheet, theme);

	it("uses only classes the compiled stylesheet styles with usable values", () => {
		const names = classesInSource("builtins/DataTable.tsx", ["ALIGN", "JUSTIFY"]);
		expect(names.length).toBeGreaterThan(20);
		expect(names.filter((name) => !(name in classes))).toEqual([]);
		const problems = names.flatMap((name) =>
			Object.entries(classes[name]).flatMap(([property, value]) => {
				const why = unusable(value);
				return why ? [`${name} ${property}: ${why}`] : [];
			}),
		);
		expect(problems).toEqual([]);
	});

	it("draws the rows and formatted cells inside a sideways scroll, and sorts on a header tap", async () => {
		await act(async () => Uniwind.setTheme(theme));
		await renderTable();

		expect(screen.getByText("Costs")).toBeOnTheScreen();
		expect(screen.getByText("3 rows")).toBeOnTheScreen();
		expect(screen.getAllByTestId("data-table-costs-row")).toHaveLength(3);
		expect(firstColumn()).toEqual(["Beta", "Alpha", "Gamma"]);
		expect(screen.getByText("$1,234.50")).toBeOnTheScreen();
		expect(screen.getByText("2 KB")).toBeOnTheScreen();
		expect(screen.getByText("—")).toBeOnTheScreen();
		expect(screen.getByText(LONG_NOTE)).toBeOnTheScreen();

		// The grid scrolls sideways inside the table's own box, so a wide table never widens the screen.
		const scroll = screen.getByTestId("data-table-costs-scroll");
		expect(scroll.type).toBe("RCTScrollView");
		expect(scroll.props.horizontal).toBe(true);
		expect(cellWidth(screen.getByText(LONG_NOTE))).toBe(240);
		expect(cellWidth(screen.getByText("Alpha"))).toBeLessThan(240);

		// Colours come from the theme's tokens.
		expect(StyleSheet.flatten(screen.getByText("Alpha").props.style).color).toBe(
			variables["--text-body"],
		);
		expect(StyleSheet.flatten(screen.getByText("Costs").props.style).color).toBe(
			variables["--text-heading"],
		);

		await fireEvent.press(screen.getByRole("button", { name: "Name column header" }));
		expect(firstColumn()).toEqual(["Alpha", "Beta", "Gamma"]);
		expect(screen.getByRole("button", { name: "Clear sorting" })).toBeOnTheScreen();

		await fireEvent.press(
			screen.getByRole("button", { name: "Name column header, sorted ascending" }),
		);
		expect(firstColumn()).toEqual(["Gamma", "Beta", "Alpha"]);

		await fireEvent.press(screen.getByRole("button", { name: "Cost column header" }));
		expect(firstColumn()).toEqual(["Gamma", "Beta", "Alpha"]);
		await fireEvent.press(screen.getByRole("button", { name: "Clear sorting" }));
		expect(firstColumn()).toEqual(["Beta", "Alpha", "Gamma"]);
		expect(screen.getByText("3 of 3 rows")).toBeOnTheScreen();
	});
});
